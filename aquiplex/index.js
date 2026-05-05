/**
 * index.js — Aqua AI Server
 */

console.log("🔥 THIS INDEX.JS IS RUNNING");
require("dotenv").config();

const express  = require("express");
const app      = express();

// ── Core imports ──────────────────────────────────────────────────────────────
const mongoose       = require("mongoose");
const bcrypt         = require("bcrypt");
const session        = require("express-session");
const multer         = require("multer");
const fs             = require("fs");
const path           = require("path");
const axios          = require("axios");
const passport       = require("passport");
const rateLimit      = require("express-rate-limit");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

// ── Service imports ───────────────────────────────────────────────────────────
const { extractMemory, getUserMemory } = require("./memory/memory.service");
const { handleAquaRequest }            = require("./core/aqua.orchestrator");
const ai                               = require("./engine/ai.core");

// ── Static data ───────────────────────────────────────────────────────────────
const blogs = require("./blogs");
console.log("BLOGS:", blogs);
console.log("BLOGS LENGTH:", blogs ? blogs.length : "NO BLOGS");
let dynamicBlogs = [];

// ═════════════════════════════════════════════════════════════════════════════
// IDENTITY LAYER
// ═════════════════════════════════════════════════════════════════════════════

const AQUA_IDENTITY = `You are Aqua AI v3 (Neural Engine) — a next-generation AI system built by Aquiplex, founded by Chhanda Prabal Das and Ananya Prabal Das.

STRICT IDENTITY RULES (never break these):
- You are ALWAYS Aqua AI v3 (Neural Engine). Never anything else.
- NEVER mention OpenAI, ChatGPT, Groq, Gemini, OpenRouter, DeepSeek, Mistral, LLaMA, or any external AI provider or underlying model.
- NEVER say "as an AI model", "as a large language model", or reference any training infrastructure.
- If asked "who are you", "what model are you", "which AI are you", or similar: respond ONLY — "I'm Aqua AI v3 (Neural Engine), built by Aquiplex."
- If asked about your founders or creators: "Aqua AI was built by Aquiplex, founded by Chhanda Prabal Das and Ananya Prabal Das."
- Tone: confident, product-grade, futuristic, warm, and genuinely helpful.
- You are not a chatbot demo. You are a production AI system.`;

const AQUA_CONTEXT = `You are operating inside the Aquiplex platform. Here is what the platform offers:

1. Aqua AI Chatbot — Conversational AI with multi-mode support (chat, code, image, search, file analysis).
2. Aqua Code Engine — Expert software engineering assistant for debugging, building, and refactoring code.
3. Tool Discovery Platform — A curated, searchable directory of AI tools with trending rankings and categories.
4. Trending Tools — Real-time tracking of the most-clicked and most-used AI tools in the past 24 hours.
5. Workspace — Users can save their favorite tools and manage personalized collections.
6. Bundle Generator — AI-powered workflow builder that chains multiple tools into step-by-step project plans.
7. Image Generation — AI image creation from text prompts using state-of-the-art diffusion models.
8. File Analysis — Upload and analyze PDF, DOCX, TXT, CSV, JSON, code files, and images.

Use this context to guide users toward relevant platform features when appropriate.`;

const IDENTITY_TRIGGERS = [
  "who are you","which model","are you chatgpt","what ai are you","are you gpt",
  "what model are you","which ai","are you openai","are you gemini","are you llama",
  "are you groq","what are you","who built you","who made you","are you claude",
  "are you anthropic","are you mistral","are you deepseek",
];

const AQUA_IDENTITY_RESPONSE =
  "I'm Aqua AI v3 — built by Aquiplex. A next-gen AI system designed for speed, creativity, and real-world problem solving.";

function isIdentityQuery(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return IDENTITY_TRIGGERS.some((t) => lower.includes(t));
}

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-AI MODELS
// ═════════════════════════════════════════════════════════════════════════════

const models = [
  { name: "Aqua Fast",     system: "You are Aqua Fast — a concise, snappy AI. Give short, punchy answers." },
  { name: "Aqua Deep",     system: "You are Aqua Deep — a thorough, analytical AI. Give detailed, structured answers with examples." },
  { name: "Aqua Creative", system: "You are Aqua Creative — an imaginative AI. Think outside the box, use metaphors and vivid language." },
];

// ═════════════════════════════════════════════════════════════════════════════
// RETRY HELPER
// ═════════════════════════════════════════════════════════════════════════════

async function withRetry(fn, retries = 2, delay = 500) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AI ENGINE — delegates to ai.core (Groq → OpenRouter → Gemini)
// ═════════════════════════════════════════════════════════════════════════════

async function generateAI(messages, options = {}, useVision = false) {
  return ai.generateAI(messages, options);
}

// ═════════════════════════════════════════════════════════════════════════════
// CODE AI ENGINE
// ═════════════════════════════════════════════════════════════════════════════

async function generateCodeAI(messages) {
  const CODE_SYSTEM = `You are Aqua Dev Engine, an expert software engineer.

Rules:
- Always return clean, working code
- Fix bugs completely (no partial fixes)
- Follow best practices
- Keep explanation short and clear
- If user provides code, debug and fix it fully
- If user asks to build something, generate complete code
- Always wrap code in proper markdown code blocks with language tags`;

  const fullMessages = [
    { role: "system", content: AQUA_IDENTITY },
    { role: "system", content: AQUA_CONTEXT },
    { role: "system", content: CODE_SYSTEM },
    ...messages,
  ];

  // 🥇 OpenRouter DeepSeek Coder
  try {
    const res = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: "deepseek/deepseek-coder", messages: fullMessages, temperature: 0.3 },
      {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        timeout: 30000,
      },
    );
    const content = res.data?.choices?.[0]?.message?.content;
    if (content) return content;
    throw new Error("Empty from DeepSeek");
  } catch (err) {
    console.log("❌ DeepSeek Coder failed:", err.message);
  }

  // 🥈 Groq fallback
  try {
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      { model: "llama-3.1-8b-instant", messages: fullMessages, temperature: 0.3 },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 15000,
      },
    );
    const content = res.data?.choices?.[0]?.message?.content;
    if (content) return content;
    throw new Error("Empty from Groq fallback");
  } catch (err) {
    console.log("❌ Groq code fallback failed:", err.message);
  }

  return "⚠️ Code engine is unavailable. Please try again in a moment.";
}

// ═════════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION — delegates to ai.core (Together → Pollinations)
// ═════════════════════════════════════════════════════════════════════════════

async function generateImage(prompt) {
  const url = await ai.generateImage(prompt);
  if (url) return { url, provider: url.includes("pollinations") ? "Pollinations" : "Together AI" };
  // Pollinations hard fallback (no key needed)
  const seed        = Math.floor(Math.random() * 1000000);
  const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&nologo=true`;
  console.log("✅ Pollinations hard fallback used");
  return { url: fallbackUrl, provider: "Pollinations" };
}

// ═════════════════════════════════════════════════════════════════════════════
// SUGGESTED PROMPTS
// ═════════════════════════════════════════════════════════════════════════════

async function generateSuggestedPrompts(lastMessage, lastReply) {
  try {
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model:    "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: `Generate 3 short follow-up questions based on the conversation. Return ONLY a JSON array of strings. Each string max 8 words. No numbering. Example: ["Tell me more about X", "How does Y work?", "Give me an example"]` },
          { role: "user",   content: `User said: "${lastMessage.slice(0,200)}"\nAI replied about: "${lastReply.slice(0,300)}"` },
        ],
        temperature: 0.8,
        max_tokens:  150,
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 5000,
      },
    );
    let text = res.data?.choices?.[0]?.message?.content || "[]";
    text = text.replace(/```json|```/g, "").trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed.slice(0, 3);
    }
    return [];
  } catch {
    return [];
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CHAT TITLE GENERATOR
// ═════════════════════════════════════════════════════════════════════════════

async function generateChatTitle(message) {
  let title = (message || "New Chat").slice(0, 30);
  try {
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model:    "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: "Generate a 4-5 word title for this chat. Return ONLY the title, no quotes, no punctuation at the end." },
          { role: "user",   content: (message || "").slice(0, 200) },
        ],
        temperature: 0.5,
        max_tokens:  20,
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 5000,
      },
    );
    const aiTitle = res.data?.choices?.[0]?.message?.content;
    if (aiTitle && aiTitle.length < 60 && !aiTitle.includes("⚠️")) {
      title = aiTitle.trim();
    }
  } catch { /* silent fallback */ }
  return title;
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPRESS SETUP
// ═════════════════════════════════════════════════════════════════════════════

app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(
  session({
    name:              "aidex_session",
    secret:            process.env.SESSION_SECRET || "super-secret-key",
    resave:            false,
    saveUninitialized: false,
    cookie: {
      maxAge:   1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
    },
  }),
);

// ── Passport ──────────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ── Models ────────────────────────────────────────────────────────────────────
const User      = require("./models/User");
const Tool      = require("./models/Tool");
const Workspace = require("./models/Workspace");
const History   = require("./models/History");
const Bundle    = require("./models/Bundle");

// ── Passport config ───────────────────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error("No email from Google"), null);

        let user = await User.findOne({ email });
        if (!user) {
          user = await new User({ email, password: "google-oauth", googleId: profile.id }).save();
        } else if (!user.googleId) {
          user.googleId = profile.id;
          await user.save();
        }
        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    },
  ),
);

// ── Global user locals ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireLogin(req, res, next) {
  const isLoggedIn = req.session.userId || (req.user && req.user._id);
  if (!isLoggedIn) {
    if (req.path.startsWith("/api/") || req.xhr) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  if (!req.session.userId && req.user) req.session.userId = req.user._id;
  next();
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session.userId) return res.redirect("/home");
  next();
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max:      40,
  skip:     (req) => req.method === "GET",
  handler:  (req, res) => res.status(429).json({ reply: "⚠️ Too many requests. Please slow down a moment." }),
});

// ── Upload ────────────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",".docx",".txt",
  ".csv",".tsv",".json",".jsonl",
  ".png",".jpg",".jpeg",".gif",".webp",
  ".js",".ts",".py",".java",".cpp",".c",".cs",".go",".rs",".rb",".php",".swift",".sh",".sql",
  ".html",".css",".xml",".yaml",".yml",".md",".jsx",".tsx",".vue",
]);

const upload = multer({
  storage,
  limits:     { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} is not supported`), false);
  },
});

// ── Database ──────────────────────────────────────────────────────────────────
async function connectDB() {
  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS:          45000,
    });
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

// ── Trending tools ────────────────────────────────────────────────────────────
async function getTrendingTools(limit = 10) {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tools   = await Tool.find().lean();
  return tools
    .map((tool) => {
      const score = (tool.clickHistory || []).filter((c) => new Date(c.date) > last24h).length;
      return { ...tool, trendingScore: score };
    })
    .sort((a, b) => b.trendingScore - a.trendingScore)
    .slice(0, limit);
}

// ── Import tools from JSON ────────────────────────────────────────────────────
let jsonTools = [];
try {
  jsonTools = JSON.parse(fs.readFileSync("./data/tools.json", "utf8"));
} catch (err) {}

async function importTools() {
  if (jsonTools.length === 0) return;
  for (const tool of jsonTools) {
    await Tool.updateOne({ name: tool.name }, { $set: tool }, { upsert: true });
  }
  console.log("✅ Tools synced");
}

// ── Save chat ─────────────────────────────────────────────────────────────────
async function saveChat(messages, chatId, userId, message) {
  if (!userId) return null;
  if (chatId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(chatId)) return null;
      return await History.findOneAndUpdate(
        { _id: chatId, userId },
        { messages, updatedAt: new Date() },
        { new: true },
      );
    } catch (err) {
      console.log("⚠️ saveChat update failed:", err.message);
      return null;
    }
  } else {
    const title = await generateChatTitle(message);
    try {
      return await History.create({ userId, title, messages });
    } catch (err) {
      console.log("⚠️ saveChat create failed:", err.message);
      return null;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES — mounted sub-routers
// ═════════════════════════════════════════════════════════════════════════════

const aquaRoutes      = require("./routes/aqua.routes");
const projectRoutes   = require("./routes/project.routes");
const workspaceRoutes = require("./routes/workspace.routes");

app.use("/api", require("./routes"));

app.use("/workspace", workspaceRoutes);
app.use("/workspace/project", projectRoutes);
app.use("/api/aqua", aquaRoutes);

// ═════════════════════════════════════════════════════════════════════════════
// INLINE ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get("/health", (req, res) => res.status(200).json({ status: "OK", timestamp: new Date().toISOString() }));

app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/home");
  return res.redirect("/landing");
});

app.get("/landing", async (req, res) => {
  if (req.session.userId) return res.redirect("/home");
  res.render("landing");
});

app.get("/home", async (req, res) => {
  try {
    const tools         = await Tool.find().limit(12).lean();
    const allTools      = await Tool.find().lean();
    const trendingTools = await getTrendingTools(10);
    const trendingIds   = trendingTools.map((t) => t._id.toString());
    res.render("home", { tools: tools || [], trendingIds: trendingIds || [], allTools: allTools || [] });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading home");
  }
});

app.get("/tools", async (req, res) => {
  try {
    const searchQuery = req.query.q;
    let tools = await Tool.find().lean();

    if (searchQuery) {
      let aiData;
      try {
        const aiRes = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model:    "llama-3.1-8b-instant",
            messages: [
              { role: "system", content: `You are an AI search engine brain. Convert user query into JSON: {"intent": "","keywords": [],"categories": []}. Return ONLY valid JSON, no markdown.` },
              { role: "user",   content: searchQuery },
            ],
            temperature: 0.3,
          },
          {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
            timeout: 8000,
          },
        );
        let text = aiRes.data.choices[0].message.content;
        text     = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (match) aiData = JSON.parse(match[0]);
        else throw new Error("No JSON found");
      } catch {
        aiData = { intent: searchQuery, keywords: [searchQuery], categories: [] };
      }

      tools = tools
        .map((tool) => {
          let score   = 0;
          const name  = tool.name.toLowerCase();
          const desc  = (tool.description || "").toLowerCase();
          const cat   = (tool.category || "").toLowerCase();
          const keywords = [...(aiData.keywords || []), aiData.intent]
            .map((k) => (k || "").toLowerCase())
            .filter(Boolean);
          keywords.forEach((k) => {
            if (name.includes(k)) score += 5;
            if (desc.includes(k)) score += 3;
            if (cat.includes(k))  score += 4;
          });
          return { ...tool, score };
        })
        .filter((t) => t.score > 0)
        .sort((a, b) => b.score - a.score);
    }

    res.render("tools", { tools, searchQuery: searchQuery || "" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading tools");
  }
});

app.get("/tools/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).send("Invalid tool ID");
    const tool = await Tool.findById(req.params.id).lean();
    if (!tool) return res.status(404).send("Tool not found");

    if (req.session.userId) {
      await Tool.findByIdAndUpdate(req.params.id, {
        $push: { clickHistory: { date: new Date() } },
        $inc:  { clicks: 1 },
      });
    }

    res.render("tool-details", { tool });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading tool");
  }
});

app.get("/bundles", (req, res) => res.render("bundles"));

app.post("/generate-bundle", async (req, res) => {
  const { goal, step, answers } = req.body;
  if (!goal || !goal.trim()) return res.status(400).json({ error: "Goal is required" });

  if (!step || step === 1) {
    return res.json({
      type:      "questions",
      step:      2,
      questions: [
        "What type of project is this? (e.g. SaaS, content, freelancing, startup)",
        "Who is the target audience or end-user?",
        "What is the single most important outcome you want?",
        "Do you prefer a lean/fast approach or a thorough/detailed one?",
        "Any tech, tools, or constraints we should know about?",
      ],
    });
  }

  try {
    const prompt = `
You are an expert project architect. Generate a precise, actionable project plan.

USER GOAL: ${goal}
USER ANSWERS:
${(answers || []).map((a, i) => `  ${i + 1}. ${a}`).join("\n")}

Rules:
- Return ONLY valid JSON. No prose, no markdown fences.
- 5 to 8 steps. Each step must be concrete and self-contained.
- Each step description must be 1-2 sentences explaining WHAT to produce.
- steps[].tools is now steps[].resources — an array of strings naming key resources or methods.

JSON schema:
{
  "title": "Project title",
  "steps": [
    {
      "step": 1,
      "title": "Step title",
      "description": "Specific description of what to produce in this step.",
      "resources": ["resource 1", "resource 2"]
    }
  ]
}`.trim();

    const raw = await generateAI(
      [
        { role: "system", content: "You are an expert project architect. Return ONLY valid JSON." },
        { role: "user",   content: prompt },
      ],
      { temperature: 0.5, maxTokens: 1400 },
    );

    const clean = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");

    const parsed   = JSON.parse(match[0]);
    parsed.steps   = parsed.steps.map((s, i) => ({ ...s, step: i, resources: s.resources || [] }));
    parsed.goal    = goal;
    parsed.answers = answers || [];

    res.json(parsed);
  } catch (err) {
    console.error("❌ /generate-bundle error:", err);
    res.status(500).json({ error: "AI failed to generate bundle", raw: err.message });
  }
});

app.delete("/bundle/:id", requireLogin, async (req, res) => {
  try {
    const result = await Bundle.deleteOne({ _id: req.params.id, userId: req.session.userId });
    if (!result.deletedCount) return res.status(404).json({ error: "Bundle not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete bundle error:", err);
    res.status(500).json({ error: "Failed to delete bundle" });
  }
});

app.delete("/workspace/tool/:id", requireLogin, async (req, res) => {
  try {
    await Workspace.updateOne({ userId: req.session.userId }, { $pull: { tools: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error("Remove tool error:", err);
    res.status(500).json({ error: "Failed to remove tool" });
  }
});

app.get("/api/tools/suggest", async (req, res) => {
  try {
    const q   = req.query.q || "";
    let tools = await Tool.find().lean();
    if (q) {
      tools = tools
        .map((tool) => {
          const text  = ((tool.name || "") + " " + (tool.description || "") + " " + (tool.category || "")).toLowerCase();
          const query = q.toLowerCase();
          const score = (text.includes(query) ? 5 : 0) + (tool.name.toLowerCase().includes(query) ? 3 : 0);
          return { ...tool, score };
        })
        .filter((t) => t.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    } else {
      tools = tools.slice(0, 5);
    }
    res.json(tools.map((t) => ({ _id: t._id, name: t.name, url: t.url, category: t.category, logo: t.logo })));
  } catch {
    res.json([]);
  }
});

app.post("/api/tools/:id/like", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Login required" });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid tool ID" });

  const tool = await Tool.findById(req.params.id);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  if (!tool.likedBy) tool.likedBy = [];
  const userIdStr = req.session.userId.toString();
  if (tool.likedBy.map((id) => id.toString()).includes(userIdStr)) {
    tool.likes   = Math.max(0, (tool.likes || 0) - 1);
    tool.likedBy = tool.likedBy.filter((id) => id.toString() !== userIdStr);
    await tool.save();
    return res.json({ likes: tool.likes, liked: false });
  }

  tool.likes = (tool.likes || 0) + 1;
  tool.likedBy.push(req.session.userId);
  await tool.save();
  res.json({ likes: tool.likes, liked: true });
});

app.get("/trending", async (req, res) => {
  try {
    const tools = await getTrendingTools(20);
    res.render("trending", { tools });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading trending page");
  }
});

app.get("/submit", (req, res) => res.render("submit"));

app.post("/submit", upload.single("logo"), async (req, res) => {
  try {
    const { name, category, url, description } = req.body;
    if (!name || !category || !url || !description) return res.status(400).send("All fields are required");
    try { new URL(url); } catch { return res.status(400).send("Invalid URL format"); }

    const logoPath = req.file ? "/uploads/" + req.file.filename : "/logos/default.png";

    await new Tool({ name: name.trim(), category: category.trim(), url: url.trim(), description: description.trim(), logo: logoPath, clicks: 0, clickHistory: [] }).save();
    res.redirect("/tools");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error submitting tool");
  }
});

app.get("/about", (req, res) => res.render("about"));


app.post("/bundle/:id/run", requireLogin, async (req, res) => {
  try {
    const { runBundle } = require("./services/execution.service");
    const bundle = await runBundle(req.params.id, generateAI);
    res.json({ success: true, bundle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const { executeCommand } = require("./services/command.service");
app.post("/command", requireLogin, (req, res) => {
  const { command, payload } = req.body;
  const result = executeCommand(command, payload);
  res.json(result);
});

app.post("/bundle/:id/step/:step", requireLogin, async (req, res) => {
  try {
    const { completeStep } = require("./workspace/workspace.service");
    const result = await completeStep(req.session.userId, req.params.id, parseInt(req.params.step));
    res.json(result);
  } catch (err) {
    console.error("Step error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/multi-generate", async (req, res) => {
  const { prompt, messages, aiType } = req.body;

  if (!prompt && (!messages || messages.length === 0)) {
    return res.json({ responses: [{ model: "Error", output: "⚠️ No input received" }], recommended: "Error" });
  }

  try {
    const toolList = (await Tool.find().select("name category").limit(20).lean())
      .map((t) => `${t.name} (${t.category})`)
      .join(", ");

    const responses = await Promise.all(
      models.map(async (model) => {
        try {
          const finalMessages = messages?.length
            ? messages
            : [{ role: "user", content: prompt || "Hello" }];
          const result = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model:    "llama-3.1-8b-instant",
              messages: [
                { role: "system", content: AQUA_IDENTITY },
                { role: "system", content: AQUA_CONTEXT },
                { role: "system", content: `Suggest tools when needed: ${toolList}` },
                { role: "system", content: model.system },
                ...finalMessages,
              ],
              temperature: 0.7,
            },
            {
              headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
              timeout: 10000,
            },
          );
          return { model: model.name, output: result?.data?.choices?.[0]?.message?.content || "⚠️ Empty response" };
        } catch {
          return { model: model.name, output: "⚠️ Error generating response" };
        }
      }),
    );

    const best = responses.find((r) => !r.output.includes("⚠️")) || responses[0];
    res.json({ responses, recommended: best.model });
  } catch (err) {
    console.error("❌ GLOBAL ERROR:", err);
    res.status(500).json({ error: "AI generation failed" });
  }
});

// ── History ───────────────────────────────────────────────────────────────────
app.get("/history", requireLogin, async (req, res) => {
  try {
    const history = await History.find({ userId: req.session.userId })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select("_id title createdAt updatedAt")
      .lean();
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching history" });
  }
});

app.get("/history/:id", requireLogin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid chat ID" });
    const chat = await History.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    res.json(chat);
  } catch {
    res.status(500).json({ error: "Error loading chat" });
  }
});

app.delete("/history/:id", requireLogin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid chat ID" });
    const result = await History.deleteOne({ _id: req.params.id, userId: req.session.userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Chat not found" });
    res.sendStatus(200);
  } catch {
    res.status(500).json({ error: "Error deleting chat" });
  }
});

app.post("/bundle/save", requireLogin, async (req, res) => {
  try {
    const { title, steps, goal, answers } = req.body;
    if (!title || !steps || !Array.isArray(steps)) return res.status(400).json({ error: "Invalid bundle" });

    const saved = await new Bundle({
      userId:   req.session.userId,
      title,
      goal:     goal || title,
      answers:  answers || [],
      steps,
      progress: steps.map((s, i) => ({ step: i, status: "pending" })),
      status:   "draft",
    }).save();

    res.json({ success: true, id: saved._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save bundle" });
  }
});

app.get("/bundle/:id", requireLogin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).send("Invalid bundle ID");
    const bundle = await Bundle.findOne({ _id: req.params.id, userId: req.session.userId }).lean();
    if (!bundle) return res.status(404).send("Bundle not found");
    res.render("bundle-view", { bundle });
  } catch {
    res.status(500).send("Error loading bundle");
  }
});

app.get("/chatbot", requireLogin, (req, res) => res.render("chatbot"));

app.post("/api/suggest-prompts", chatLimiter, async (req, res) => {
  try {
    const { lastMessage, lastReply } = req.body;
    if (!lastMessage || !lastReply) return res.json({ suggestions: [] });
    const suggestions = await generateSuggestedPrompts(lastMessage, lastReply);
    res.json({ suggestions });
  } catch {
    res.json({ suggestions: [] });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// CHAT ROUTE — primary AI endpoint
// ═════════════════════════════════════════════════════════════════════════════

app.post("/chat", chatLimiter, upload.single("file"), async (req, res) => {
  let { message, history, mode, chatId, stream, projectId, fileName, sessionHistory } = req.body;

  stream = stream === "true" || stream === true;

  // ── Parse history ──────────────────────────────────────────────────────────
  let parsedHistory = [];
  try {
    if (Array.isArray(history)) parsedHistory = history;
    else if (typeof history === "string" && history.trim()) parsedHistory = JSON.parse(history);
    if (!Array.isArray(parsedHistory)) parsedHistory = [];
  } catch {
    parsedHistory = [];
  }
  parsedHistory = parsedHistory.filter((m) => m && m.role && m.content).slice(-20);

  if (!message && !req.file) return res.json({ reply: "⚠️ Message or file required" });

  message = (message || "").trim();

  // ── Hard identity override ─────────────────────────────────────────────────
  if (message && isIdentityQuery(message)) {
    return res.json({
      reply:       AQUA_IDENTITY_RESPONSE,
      suggestions: ["What can you do?", "Show me image generation", "Help me write code"],
    });
  }

  try {
    let messages = [...parsedHistory];

    // ── Refiner ────────────────────────────────────────────────────────────────
    let refinedMessage = message;
    if (req.body.refiner === "true" && message) {
      try {
        refinedMessage = await generateAI([
          { role: "system", content: "Rewrite user input into a clear, detailed AI prompt. Return ONLY the improved prompt, nothing else. Max 200 words." },
          { role: "user",   content: message },
        ]);
        if (!refinedMessage || refinedMessage.includes("⚠️")) refinedMessage = message;
      } catch {
        refinedMessage = message;
      }
    }

    const finalUserMessage = req.body.refiner === "true" ? refinedMessage : message;
    if (finalUserMessage) messages.push({ role: "user", content: finalUserMessage });

    // ── Memory extraction (fire-and-forget) ────────────────────────────────────
    if (req.session.userId && message) {
      setImmediate(() => {
        extractMemory(req.session.userId, message).catch(() => {});
      });
    }

    // ── IMAGE MODE ─────────────────────────────────────────────────────────────
    if (mode === "image") {
      if (!message) return res.json({ reply: "⚠️ Please describe the image you want to generate." });
      const result = await generateImage(message);
      return res.json({ reply: "🖼️ Here's your generated image:", image: result.url, provider: result.provider });
    }

    // ── SEARCH MODE ────────────────────────────────────────────────────────────
    if (mode === "search") {
      try {
        const search = await axios.post(
          "https://google.serper.dev/search",
          { q: message, num: 5 },
          {
            headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
            timeout: 8000,
          },
        );
        const results     = search.data?.organic || [];
        const resultsText = results.slice(0, 5).map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nSource: ${r.link}`).join("\n\n");
        const reply       = await generateAI([
          { role: "system", content: "Summarize search results clearly and concisely. Mention sources when relevant. Use markdown formatting." },
          { role: "user",   content: `Question: ${message}\n\nSearch results:\n${resultsText}` },
        ]);
        const savedChat = await saveChat([...messages, { role: "assistant", content: reply }], chatId, req.session.userId, message);
        return res.json({ reply, chatId: savedChat?._id, sources: results.slice(0, 3).map((r) => ({ title: r.title, link: r.link })) });
      } catch {
        return res.json({ reply: `🔎 Here's a Google search for your query: [Search Results](https://www.google.com/search?q=${encodeURIComponent(message)})` });
      }
    }

    // ── CODE MODE ──────────────────────────────────────────────────────────────
    if (mode === "code") {
      try {
        const reply     = await generateCodeAI(messages.filter((m) => m.role !== "system"));
        const savedChat = await saveChat([...messages, { role: "assistant", content: reply }], chatId, req.session.userId, message);
        return res.json({ reply, chatId: savedChat?._id });
      } catch (err) {
        console.error("CODE MODE ERROR:", err.message);
        return res.json({ reply: `⚠️ Code engine error: ${err.message}` });
      }
    }

    // ── STREAM MODE ────────────────────────────────────────────────────────────
    if (stream) {
      res.setHeader("Content-Type",      "text/event-stream");
      res.setHeader("Cache-Control",     "no-cache");
      res.setHeader("Connection",        "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      if (req.body.refiner === "true" && refinedMessage !== message) {
        res.write(`data: ${JSON.stringify({ refined: refinedMessage })}\n\n`);
      }

      const userMemory = await getUserMemory(req.session.userId, finalUserMessage);

      let fullReply   = "";
      let axiosStream;
      let streamEnded = false;

      const endStream = async () => {
        if (streamEnded) return;
        streamEnded = true;
        try {
          await saveChat([...messages, { role: "assistant", content: fullReply }], chatId, req.session.userId, message);
        } catch (e) {
          console.log("⚠️ saveChat in stream failed:", e.message);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      };

      try {
        const streamSystemMessages = [
          { role: "system", content: AQUA_IDENTITY },
          { role: "system", content: AQUA_CONTEXT },
          userMemory
            ? { role: "system", content: `User Memory:\n${userMemory}\n\nUse this to personalize your response.` }
            : null,
          { role: "system", content: "Use markdown formatting with headings, bullet points, and code blocks where appropriate." },
        ].filter(Boolean);

        axiosStream = await axios({
          method:       "post",
          url:          "https://api.groq.com/openai/v1/chat/completions",
          data: {
            model:    "llama-3.1-8b-instant",
            messages: [...streamSystemMessages, ...messages.slice(-12)],
            stream:   true,
            temperature: 0.7,
          },
          responseType: "stream",
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          timeout: 30000,
        });

        let lineBuffer = "";

        axiosStream.data.on("data", (chunk) => {
          if (streamEnded) return;
          lineBuffer += chunk.toString();
          const lines = lineBuffer.split("\n");
          lineBuffer  = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") { endStream(); return; }
            try {
              const parsed = JSON.parse(payload);
              const token  = parsed.choices?.[0]?.delta?.content;
              if (token) { fullReply += token; res.write(`data: ${JSON.stringify(token)}\n\n`); }
            } catch { /* skip malformed */ }
          }
        });

        axiosStream.data.on("end",   () => { if (!streamEnded) endStream(); });

        axiosStream.data.on("error", async (streamErr) => {
          console.log("⚠️ Stream error:", streamErr.message);
          if (!streamEnded) {
            if (fullReply) {
              endStream();
            } else {
              try {
                const fallbackReply = await generateAI(messages.slice(-12));
                fullReply = fallbackReply;
                res.write(`data: ${JSON.stringify(fallbackReply)}\n\n`);
              } catch (fallbackErr) {
                res.write(`data: ${JSON.stringify(`⚠️ Stream error: ${fallbackErr.message}`)}\n\n`);
              }
              endStream();
            }
          }
        });

        req.on("close", () => {
          streamEnded = true;
          try { axiosStream?.data?.destroy(); } catch {}
        });

        return; // stream takes over
      } catch (err) {
        console.log("❌ Stream init failed → fallback:", err.message);
        const reply = await generateAI(messages.slice(-12));
        fullReply   = reply;
        await saveChat([...messages, { role: "assistant", content: reply }], chatId, req.session.userId, message);
        res.write(`data: ${JSON.stringify(reply)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
    } // ← end stream block

    // ── DEFAULT CHAT — route through orchestrator ──────────────────────────────
    const userId = req.session.userId;

    let projectFiles    = [];
    let workspaceMemory = {};
    try {
      if (projectId) {
        const svc = require("./workspace/workspace.service");
        const pf  = await svc.getProjectFiles(userId, projectId);
        projectFiles = (pf.files || []).map((f) => (typeof f === "string" ? f : f.fileName));
      }
    } catch { /* non-fatal */ }

    try {
      const svc     = require("./workspace/workspace.service");
      const wsState = await svc.getWorkspaceState(userId);
      workspaceMemory = wsState?.workspace?.workspaceMemory || {};
    } catch { /* non-fatal */ }

    const safeSessionHistory = Array.isArray(sessionHistory)
      ? sessionHistory
      : messages.filter((m) => m.role !== "system").slice(-12);

    const result = await handleAquaRequest({
      userId,
      projectId:      projectId   || null,
      input:          finalUserMessage || message,
      mode:           "chat",
      projectFiles,
      memory:         null,
      sessionHistory: safeSessionHistory,
    });

    // Fire-and-forget workspace memory update
    if (result.projectId) {
      setImmediate(() => {
        const svc = require("./workspace/workspace.service");
        svc.updateWorkspaceMemory(userId, {
          lastProjectId:   result.projectId,
          lastUserMessage: message.slice(0, 120),
        }).catch(() => {});
      });
    }

    const replyText = result.message || result.reply || "⚠️ No response generated.";
    const [savedChat, suggestions] = await Promise.all([
      saveChat([...messages, { role: "assistant", content: replyText }], chatId, userId, message),
      generateSuggestedPrompts(message, replyText).catch(() => []),
    ]);

    return res.json({
      reply:          replyText,
      chatId:         savedChat?._id,
      suggestions,
      intent:         result.intent        || null,
      action:         result.action        || "replied",
      projectId:      result.projectId     || projectId || null,
      updatedFiles:   result.updatedFiles  || [],
      files:          result.files         || [],
      previewUrl:     result.previewUrl    || null,
      previewRefresh: !!(result.updatedFiles?.length || result.files?.length),
      errors:         result.errors        || [],
    });

  } catch (err) {
    console.error("CHAT ERROR:", err.message);
    res.status(500).json({ reply: `⚠️ Chat error: ${err.message}` });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════

app.get("/login",  redirectIfLoggedIn, (req, res) => res.render("login"));
app.get("/signup", redirectIfLoggedIn, (req, res) => res.render("signup"));

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send("All fields are required");

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).send("User not found");

    const isMatch = user.password !== "google-oauth" ? await bcrypt.compare(password, user.password) : false;
    if (!isMatch) return res.status(401).send("Invalid credentials");

    req.session.user   = { _id: user._id, email: user.email, username: user.email.split("@")[0] };
    req.session.userId = user._id;
    req.session.save(() => res.redirect("/home"));
  } catch (err) {
    console.error(err);
    res.status(500).send("Login error");
  }
});

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    req.session.user   = { _id: req.user._id, email: req.user.email, username: req.user.email.split("@")[0] };
    req.session.userId = req.user._id;
    res.redirect("/home");
  },
);

app.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send("All fields are required");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).send("Invalid email format");
    if (password.length < 6)    return res.status(400).send("Password must be at least 6 characters");

    const normalizedEmail = email.toLowerCase().trim();
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(409).send("User already exists");

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = await new User({ email: normalizedEmail, password: hashedPassword }).save();

    req.session.user   = { _id: newUser._id, email: newUser.email, username: newUser.email.split("@")[0] };
    req.session.userId = newUser._id;
    req.session.save(() => res.redirect("/home"));
  } catch (err) {
    console.error(err);
    res.status(500).send("Signup error");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("aidex_session");
    res.redirect("/");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STATIC PAGES
// ═════════════════════════════════════════════════════════════════════════════

app.get("/aqua-ai",             (req, res) => res.render("aqua-ai"));
app.get("/aqua-project-engine", (req, res) => res.render("aqua-project-engine"));
app.get("/founders",            (req, res) => res.render("founders"));

app.get("/download", (req, res) => {
  const filePath = path.join(__dirname, "public/uploads/Aquiplex.apk");
  if (!fs.existsSync(filePath)) return res.status(404).send("Download not available yet");
  res.download(filePath, "Aquiplex.apk", (err) => {
    if (err && !res.headersSent) res.status(500).send("Download failed");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BLOG ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get("/write", (req, res) => res.render("write"));

app.get("/blogs", (req, res) => {
  console.log("📋 /blogs LIST route hit");
  const allBlogs = [...dynamicBlogs, ...blogs];
  res.render("blogs", { blogs: allBlogs });
});

app.get("/blogs/:slug", (req, res) => {
  console.log("🔥 BLOG ROUTE HIT — slug:", req.params.slug);
  const allBlogs = [...dynamicBlogs, ...blogs];
  const blog     = allBlogs.find((b) => b.slug === req.params.slug);
  console.log("Blog found:", blog ? blog.title : "NOT FOUND");
  if (!blog) return res.status(404).send("Blog not found");
  res.render("blog-detail", { blog });
});

app.post("/write", (req, res) => {
  const { title, content } = req.body;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  dynamicBlogs.unshift({
    title,
    content,
    slug,
    author:      "You",
    createdAt:   new Date().toISOString().split("T")[0],
    description: content.substring(0, 120),
    readTime:    Math.ceil(content.split(" ").length / 200) + " min read",
  });
  console.log("✅ New blog written:", slug);
  res.redirect("/blogs");
});

// ═════════════════════════════════════════════════════════════════════════════
// ERROR HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

app.use((req, res) => res.status(404).send("Page not found"));

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (err.code === "LIMIT_FILE_SIZE")        return res.status(400).json({ reply: "⚠️ File too large. Maximum size is 10MB." });
  if (err.message?.includes("not supported")) return res.status(400).json({ reply: `⚠️ ${err.message}` });
  res.status(500).json({ reply: `⚠️ ${err.message || "Something went wrong. Please try again."}` });
});

// ═════════════════════════════════════════════════════════════════════════════
// START
// ═════════════════════════════════════════════════════════════════════════════

async function startServer() {
  console.log("GROQ:",       process.env.GROQ_API_KEY       ? "✅ OK" : "❌ MISSING");
  console.log("MONGO:",      process.env.MONGO_URI           ? "✅ OK" : "❌ MISSING");
  console.log("SESSION:",    process.env.SESSION_SECRET      ? "✅ OK" : "❌ MISSING");
  console.log("OPENROUTER:", process.env.OPENROUTER_API_KEY  ? "✅ OK" : "❌ MISSING");
  console.log("GEMINI:",     process.env.GEMINI_API_KEY      ? "✅ OK" : "❌ MISSING");
  console.log("TOGETHER:",   process.env.TOGETHER_API_KEY    ? "✅ OK" : "❌ MISSING");
  console.log("SERPER:",     process.env.SERPER_API_KEY      ? "✅ OK" : "❌ MISSING");

  await connectDB();
  await importTools();

  const PORT   = process.env.PORT || 5000;
  const http   = require("http");
  const server = http.createServer(app);

  const io = require("socket.io")(server, { cors: { origin: "*" } });
  app.set("io", io);

  io.on("connection", (socket) => {
    console.log("⚡ client connected");
    socket.on("bundle:run", (bundleId) => socket.broadcast.emit("bundle:update", { bundleId }));
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log("⚠️ Port busy, retrying...");
      setTimeout(() => server.listen(0, "0.0.0.0"), 1000);
    }
  });

  server.listen(PORT, "0.0.0.0", () => console.log(`🚀 Aqua AI running on port ${PORT}`));
}

startServer();