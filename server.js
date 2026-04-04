require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");

const app = express();

/* =========================
   🔧 MIDDLEWARE (TOP)
========================= */
app.use(express.json());
app.use(express.static("public"));

/* =========================
   🧠 GROQ (MAIN CHAT)
========================= */
async function chatWithGroq(message) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama3-70b-8192",
      messages: [{ role: "user", content: message }],
    }),
  });

  const data = await res.json();
  console.log("Groq:", data);

  if (!data.choices) throw new Error("Groq failed");

  return data.choices[0].message.content;
}

/* =========================
   🔁 OPENROUTER (FALLBACK)
========================= */
async function chatWithOpenRouter(message) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3-8b-instruct",
      messages: [{ role: "user", content: message }],
    }),
  });

  const data = await res.json();

  if (!data.choices) throw new Error("OpenRouter failed");

  return data.choices[0].message.content;
}

/* =========================
   🌐 SERPER SEARCH
========================= */
async function searchWeb(query) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query }),
  });

  const data = await res.json();

  return data.organic
    ?.slice(0, 3)
    .map((r) => `${r.title}: ${r.snippet}`)
    .join("\n") || "No results";
}

/* =========================
   🖼️ IMAGE
========================= */
function generateImage(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
}

/* =========================
   🚀 ROUTES
========================= */

app.get("/", (req, res) => {
  res.send("Aquiplex AI is running 🚀");
});

app.get("/test", async (req, res) => {
  try {
    const reply = await chatWithGroq("Hello");
    res.send(reply);
  } catch (err) {
    res.send("Error: " + err.message);
  }
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;

  try {
    if (!message) {
      return res.json({ type: "text", data: "No message provided" });
    }

    // 🖼️ Image
    if (message.toLowerCase().includes("image")) {
      return res.json({ type: "image", data: generateImage(message) });
    }

    // 🌐 Search
    if (
      message.toLowerCase().includes("latest") ||
      message.toLowerCase().includes("news")
    ) {
      const searchData = await searchWeb(message);
      const reply = await chatWithGroq(
        `Answer using this data:\n${searchData}`
      );
      return res.json({ type: "text", data: reply });
    }

    // 💬 Chat
    let reply;
    try {
      reply = await chatWithGroq(message);
    } catch {
      reply = await chatWithOpenRouter(message);
    }

    res.json({ type: "text", data: reply });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something broke" });
  }
});

/* =========================
   🚀 START SERVER
========================= */
app.listen(5000, "0.0.0.0", () => {
  console.log("Server running on port 5000");
});