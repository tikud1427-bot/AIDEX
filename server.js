require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

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
  console.log(data); // 👈 ADD THIS
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
  if (!data.choices) {
    console.log("Groq Error:", data);
    throw new Error("Groq failed");
  }
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
    .slice(0, 3)
    .map((r) => `${r.title}: ${r.snippet}`)
    .join("\n");
}

/* =========================
   🖼️ IMAGE (Pollinations)
========================= */
function generateImage(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
}

/* =========================
   🚀 MAIN ROUTER
========================= */
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  try {
    // 🖼️ Image request detection
    if (message.toLowerCase().includes("image")) {
      const img = generateImage(message);
      return res.json({ type: "image", data: img });
    }

    // 🌐 Search detection
    if (
      message.toLowerCase().includes("latest") ||
      message.toLowerCase().includes("news")
    ) {
      const searchData = await searchWeb(message);
      const final = await chatWithGroq(
        `Answer using this data:\n${searchData}`
      );
      return res.json({ type: "text", data: final });
    }

    // 💬 Normal chat with fallback
    let reply;
    try {
      reply = await chatWithGroq(message);
    } catch {
      reply = await chatWithOpenRouter(message);
    }

    res.json({ type: "text", data: reply });
  } catch (err) {
    res.status(500).json({ error: "Something broke" });
  }
});

app.get("/", (req, res) => {
  res.send("Aquiplex AI is running 🚀");
});
/* =========================
   🚀 START SERVER
========================= */
app.listen(3000, "0.0.0.0", () => {
  console.log("Server running");
});
  console.log("Server running on http://localhost:3000");
});
app.get("/test", async (req, res) => {
  const reply = await chatWithGroq("Hello");
  res.send(reply);
});