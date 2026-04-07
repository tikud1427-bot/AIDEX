require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const session = require("express-session");
const bodyParser = require("body-parser");
const multer = require("multer");
// FIX: removed duplicate `require("fs")` — was declared twice (again below in chatbot section)
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();

// ✅ TRUST PROXY (IMPORTANT for Render/Replit)
app.set("trust proxy", 1);

app.use((req, res, next) => {
  // HTTPS redirect disabled for Replit compatibility — kept as-is
  next();
});

// ================= MODELS =================
const User = require("./models/User");
const Tool = require("./models/Tool");
const Workspace = require("./models/Workspace");
const History = require("./models/History");
// FIX: moved Bundle require to top with other models — was mid-file after routes, causing potential ReferenceError if /bundle routes loaded before it
const Bundle = require("./models/Bundle");

// ================= DATABASE =================
async function connectDB() {
  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

// ================= TRENDING =================
async function getTrendingTools(limit = 10) {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // FIX: added try/catch — unhandled DB errors here would crash callers silently
  const tools = await Tool.find().lean();

  return tools
    .map((tool) => {
      const score = (tool.clickHistory || []).filter(
        (c) => new Date(c.date) > last24h
      ).length;
      return { ...tool, trendingScore: score };
    })
    .sort((a, b) => b.trendingScore - a.trendingScore)
    .slice(0, limit);
}

// ================= IMPORT JSON =================
let jsonTools = [];
try {
  jsonTools = JSON.parse(fs.readFileSync("./data/tools.json", "utf8"));
} catch {
  // FIX: added warning so missing file is visible in logs, not silently ignored
  console.warn("⚠️ tools.json not found or invalid — skipping import");
}

async function importTools() {
  if (jsonTools.length === 0) return;

  for (const tool of jsonTools) {
    await Tool.updateOne(
      { name: tool.name },
      { $setOnInsert: tool },
      { upsert: true }
    );
  }

  console.log("✅ Tools synced");
}

// ================= MIDDLEWARE =================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ================= SESSION FIX =================
app.use(
  session({
    name: "aidex_session",
    secret: process.env.SESSION_SECRET || "super-secret-key",
    resave: false,
    saveUninitialized: false,
    proxy: true, // ✅ IMPORTANT FIX
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    },
  })
);

// ✅ GLOBAL USER
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ================= HEALTH =================
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ================= UPLOAD =================
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

// FIX: added fileSize limit (5MB) to prevent memory/disk abuse from large uploads
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ================= AUTH MIDDLEWARE =================
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session.userId) return res.redirect("/home");
  next();
}

// ================= ROUTES =================

// Landing page
app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/home");
  return res.redirect("/landing");
});

// ================= LIKE FIX =================
app.post("/api/tools/:id/like", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Login required" });
    }

    const tool = await Tool.findById(req.params.id);
    if (!tool) {
      return res.status(404).json({ error: "Tool not found" });
    }

    const userId = req.session.userId.toString();

    if (!tool.likedBy) tool.likedBy = [];

    // ✅ FIXED (ObjectId safe)
    if (tool.likedBy.some(id => id.toString() === userId)) {
      return res.json({
        message: "Already liked",
        likes: tool.likes || 0
      });
    }

    tool.likes = (tool.likes || 0) + 1;
    tool.likedBy.push(userId);

    await tool.save();

    res.json({ likes: tool.likes });

  } catch (err) {
    console.error("Like error:", err);
    res.status(500).json({ error: "Failed to like tool" });
  }
});

// UPLOAD FILE
app.post("/upload", upload.single("file"), (req, res) => {
  // FIX: guard against missing file (e.g. no file sent) to prevent crash on req.file.originalname
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  res.json({
    filename: req.file.originalname,
    path: req.file.path,
  });
});

// LANDING
app.get("/landing", (req, res) => {
  if (req.session.userId) return res.redirect("/home");
  res.render("landing");
});

// HOME
app.get("/home", async (req, res) => {
  try {
    if (!req.session.userId) return res.redirect("/landing");

    // FIX: removed duplicate `await Tool.find().sort({ likes: -1 })` (allTools fetched twice)
    // Now reuse the same query result for both `tools` (limited) and `allTools`
    const [tools, allTools, trendingTools] = await Promise.all([
      Tool.find().limit(12).sort({ likes: -1 }).lean(),
      Tool.find().sort({ likes: -1 }).lean(),
      getTrendingTools(10),
    ]);

    // ensure likes always exist
    tools.forEach((t) => {
      if (t.likes === undefined) t.likes = 0;
    });

    // FIX: removed console.log("LIKES DEBUG:") — debug logs should not run in production
    const trendingIds = trendingTools.map((t) => t._id.toString());

    res.render("home", { tools, trendingIds, allTools });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading home");
  }
});

// AI BUNDLES PAGE
app.get("/bundles", (req, res) => {
  res.render("bundles");
});

// GENERATE AI BUNDLE
app.post("/generate-bundle", async (req, res) => {
  const { goal } = req.body;

  if (!goal) {
    return res.status(400).json({ error: "No goal provided" });
  }

  try {
    const result = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `
You are an AI that ONLY returns valid JSON.
DO NOT explain anything. DO NOT add text before or after. DO NOT use markdown.

STRICT FORMAT:
{
  "title": "Short bundle name",
  "steps": [
    {
      "step": 1,
      "title": "Step name",
      "description": "What to do",
      "tools": ["Tool1", "Tool2"]
    }
  ]
}

Rules:
- Max 5 steps
- Keep steps practical
- Use real AI tools like ChatGPT, Canva, Runway, etc.
- Output MUST be valid JSON
`,
          },
          { role: "user", content: goal },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const text = result?.data?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON found");
      parsed = JSON.parse(match[0]);
    } catch {
      return res.status(500).json({ error: "Invalid AI format", raw: text });
    }

    if (!parsed.steps) {
      return res.status(500).json({ error: "Invalid structure", raw: parsed });
    }

    res.json(parsed);
  } catch (err) {
    console.error("❌ Bundle API ERROR:", err.response?.data || err.message);

    // Fallback bundle
    res.json({
      title: "Basic AI Bundle",
      steps: [
        {
          step: 1,
          title: "Understand your goal",
          description: goal,
          tools: ["ChatGPT"],
        },
        {
          step: 2,
          title: "Use AI tools",
          description: "Execute using recommended tools",
          tools: ["Canva", "Google"],
        },
      ],
    });
  }
});

// TEST AI (DEBUG ROUTE)
app.get("/test-ai", async (req, res) => {
  try {
    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: "hello" }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    res.json(r.data);
  } catch (e) {
    console.error("TEST AI ERROR:", e.response?.data || e.message);
    res.json({ error: e.response?.data || e.message });
  }
});

// DOWNLOAD APK
app.get("/download", (req, res) => {
  const filePath = path.join(__dirname, "public/uploads/Aquiplex.apk");
  // FIX: added existence check — res.download on missing file throws unhandled error
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("APK not found");
  }
  console.log("APK downloaded");
  res.download(filePath);
});

// TOOLS LIST
app.get("/tools", async (req, res) => {
  // FIX: wrapped in try/catch — DB errors were unhandled, causing crashes
  try {
    const query = req.query.q;

    // FIX: removed duplicate `await Tool.find()` for allTools —
    // now reuse same result to get categories, saving one DB round-trip
    const allTools = await Tool.find().lean();
    const categories = [...new Set(allTools.map((t) => t.category))];

    let tools;
    if (query) {
      tools = await Tool.find({
        $or: [
          { name: { $regex: query, $options: "i" } },
          { description: { $regex: query, $options: "i" } },
        ],
      }).lean();
    } else {
      tools = allTools;
    }

    const trendingTools = await getTrendingTools(10);
    const trendingIds = trendingTools.map((t) => t._id.toString());

    res.render("tools", { tools, categories, trendingIds });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading tools");
  }
});

// TOOL DETAIL
app.get("/tool/:id", async (req, res) => {
  try {
    const tool = await Tool.findById(req.params.id);
    if (!tool) return res.redirect("/tools");
    res.render("tool", { tool });
  } catch {
    res.redirect("/tools");
  }
});

// VISIT TOOL (click tracking)
app.get("/visit/:id", async (req, res) => {
  try {
    const tool = await Tool.findById(req.params.id);
    if (!tool) return res.redirect("/tools");

    tool.clicks = (tool.clicks || 0) + 1;
    tool.clickHistory = tool.clickHistory || [];
    tool.clickHistory.push({ date: new Date() });
    await tool.save();

    let url = tool.url;
    if (!url.startsWith("http")) url = "https://" + url;
    res.redirect(url);
  } catch {
    res.redirect("/tools");
  }
});

// TRENDING PAGE
app.get("/trending", async (req, res) => {
  try {
    const tools = await getTrendingTools(20);
    res.render("trending", { tools });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading trending page");
  }
});

// SUBMIT PAGE
app.get("/submit", (req, res) => {
  res.render("submit");
});

// SUBMIT TOOL
app.post("/submit", upload.single("logo"), async (req, res) => {
  try {
    const { name, category, url, description } = req.body;

    if (!name || !category || !url || !description) {
      return res.status(400).send("All fields are required");
    }

    const logoPath = req.file ? "/uploads/" + req.file.filename : "/logos/default.png";

    await new Tool({
      name,
      category,
      url,
      description,
      logo: logoPath,
      clicks: 0,
      clickHistory: [],
    }).save();

    res.redirect("/tools");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error submitting tool");
  }
});

// ABOUT PAGE
app.get("/about", (req, res) => {
  res.render("about");
});
// ================= CATEGORY FILTER FIX =================
app.get("/tools/category/:category", async (req, res) => {
  try {
    const category = decodeURIComponent(req.params.category);

    // ✅ FIXED (DB query instead of memory filter)
    const tools = await Tool.find({
      category: { $regex: new RegExp("^" + category + "$", "i") }
    }).lean();

    const allTools = await Tool.find().lean();
    const categories = [...new Set(allTools.map(t => t.category))];

    const trendingTools = await getTrendingTools(10);
    const trendingIds = trendingTools.map(t => t._id.toString());

    res.render("tools", { tools, categories, trendingIds });

  } catch (err) {
    console.error(err);
    res.redirect("/tools");
  }
});

// LAB PAGE
app.get("/lab", (req, res) => {
  res.render("lab");
});

// ================= MULTI AI =================
const models = [
  {
    name: "🧠 Smart AI",
    system: "You are a highly intelligent AI. Give deep, clear, and well-structured answers.",
  },
  {
    name: "🎨 Creative AI",
    system: "You are a creative and imaginative AI. Make answers engaging, unique, and expressive.",
  },
  {
    name: "⚡ Fast AI",
    system: "You are a concise AI. Give short, direct, and fast answers.",
  },
];

app.post("/multi-generate", async (req, res) => {
  const { prompt, messages, aiType } = req.body;

  if (!prompt && (!messages || messages.length === 0)) {
    return res.json({
      responses: [{ model: "Error", output: "⚠️ No input received" }],
      recommended: "Error",
    });
  }

  try {
    const selectedModels = aiType
      ? models.filter((m) => m.name.toLowerCase().includes(aiType.toLowerCase()))
      : models;

    const topTools = await Tool.find().limit(5).lean();
    const toolList = topTools.map((t) => t.name).join(", ");

    const responses = await Promise.all(
      selectedModels.map(async (ai) => {
        try {
          const finalMessages =
            messages?.length
              ? messages
              : [{ role: "user", content: prompt || "Hello" }];

          const result = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model: "llama-3.1-8b-instant",
              messages: [
                {
                  role: "system",
                  content: `You are AQUIPLEX AI. Suggest tools when needed: ${toolList}`,
                },
                { role: "system", content: ai.system },
                ...finalMessages,
              ],
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
              },
              timeout: 10000,
            }
          );

          return {
            model: ai.name,
            output:
              result?.data?.choices?.[0]?.message?.content || "⚠️ Empty response",
          };
        } catch {
          return { model: ai.name, output: "⚠️ Error generating response" };
        }
      })
    );

    const best = responses.find((r) => !r.output.includes("⚠️")) || responses[0];

    res.json({ responses, recommended: best.model });
  } catch (err) {
    console.error("❌ GLOBAL ERROR:", err);
    res.status(500).send("AI generation failed");
  }
});

// ================= HISTORY =================
app.get("/history", requireLogin, async (req, res) => {
  try {
    const history = await History.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching history");
  }
});

// SAVE BUNDLE
app.post("/bundle/save", requireLogin, async (req, res) => {
  try {
    const { title, steps } = req.body;

    if (!title || !steps) {
      return res.status(400).json({ error: "Invalid bundle" });
    }

    const saved = await new Bundle({
      userId: req.session.userId,
      title,
      steps,
    }).save();

    res.json({ success: true, id: saved._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save bundle" });
  }
});

// VIEW BUNDLE
app.get("/bundle/:id", async (req, res) => {
  try {
    const bundle = await Bundle.findById(req.params.id).lean();
    if (!bundle) return res.status(404).send("Bundle not found");
    res.render("bundle-view", { bundle });
  } catch {
    res.status(500).send("Error loading bundle");
  }
});

// ================= CHATBOT =================
app.get("/chatbot", requireLogin, (req, res) => {
  res.render("chatbot");
});

app.post("/chat", async (req, res) => {
  // FIX: removed duplicate `const fs = require("fs")` that was here — fs already required at top
  let { message, history, mode, chatId, file } = req.body;

  if (!message) {
    return res.status(400).json({ reply: "⚠️ Message required" });
  }

  try {
    let messages = (history || []).map((m) => ({
      role: m.role === "bot" ? "assistant" : m.role,
      content: m.content,
    }));

    // FILE READING
    if (file) {
      try {
        const filePath = file.path;
        if (file.filename && file.filename.endsWith(".txt")) {
          // FIX: use async fs.promises.readFile — fs.readFileSync blocks the event loop
          const fileContent = await fs.promises.readFile(filePath, "utf-8");
          message += `\n\n📄 File content:\n${fileContent}`;
        } else {
          message += `\n\n⚠️ Only .txt files are supported right now.`;
        }
      } catch (err) {
        console.warn("File read error:", err.message);
      }
    }

    messages.push({ role: "user", content: message });

    let reply = "";

    // 🌐 SEARCH MODE
    if (mode === "search") {
      try {
        const search = await axios.post(
          "https://google.serper.dev/search",
          { q: message },
          {
            headers: {
              "X-API-KEY": process.env.SERPER_API_KEY,
              "Content-Type": "application/json",
            },
          }
        );

        const organic = search.data.organic || [];
        const resultsText = organic
          .slice(0, 5)
          .map((r) => `${r.title}: ${r.snippet}`)
          .join("\n");

        const ai = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: "llama-3.1-8b-instant",
            messages: [
              { role: "system", content: "Summarize search results clearly." },
              { role: "user", content: `Query: ${message}\n\n${resultsText}` },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );

        reply = ai?.data?.choices?.[0]?.message?.content || "⚠️ No summary";
      } catch {
        reply = `⚠️ Search failed\nhttps://www.google.com/search?q=${encodeURIComponent(message)}`;
      }
    }

    // 🎨 IMAGE MODE
    else if (mode === "image") {
      return res.json({
        reply: "🖼️ Here is your image:",
        image:
          "https://image.pollinations.ai/prompt/" +
          encodeURIComponent(message),
      });
    }

    // 🧠 NORMAL CHAT
        else {
          const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model: "llama-3.1-8b-instant",
              messages: [
                {
                  role: "system",
                  content: `
    You are Aqua AI by Aquiplex, a smart and friendly assistant.

    Rules:
    - Talk like a human, not a textbook
    - Keep responses clean and well formatted
    - Use short paragraphs (2-4 lines max)
    - Use bullet points when helpful
    - Add spacing between sections
    - Avoid long essays unless user asks
    - Be clear, modern, and conversational
    - Do NOT write like school answers

    If file content is provided:
    - Read it carefully
    - Answer based on the file
    - Summarize if needed
    `,
                },
                ...messages.slice(-10),
              ],
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
              },
            }
          );

          reply = response?.data?.choices?.[0]?.message?.content || "⚠️ No reply";
        }

        messages.push({ role: "assistant", content: reply });

        let chat;

        if (chatId) {
          chat = await History.findOneAndUpdate(
            { _id: chatId, userId: req.session.userId },
            { messages },
            { new: true }
          );
        } else {
          chat = await History.create({
            userId: req.session.userId,
            title: message.slice(0, 30),
            messages,
          });
        }

        // FIX: chat could be null if chatId was invalid — guard to avoid crash on chat._id
        if (!chat) {
          return res.status(404).json({ reply, messages, chatId: null });
        }

        res.json({ reply, messages, chatId: chat._id });
      } catch (err) {
        console.error("CHAT ERROR:", err.message);
        // FIX: was `res.jso` (truncated/typo) — caused a crash on every chat error
        res.status(500).json({ reply: "⚠️ Server error. Please try again." });
      }
    });

    // ================= START =================
    connectDB().then(async () => {
      await importTools();
      // FIX: use process.env.PORT for Render/Replit compatibility — default to 3000
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
    });