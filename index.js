const mongoose = require("mongoose");
const fs = require("fs");

mongoose.connect(process.env.MONGO_URI);

mongoose.connection.once("open", () => {
  console.log("MongoDB connected");
});

const toolSchema = new mongoose.Schema({
  id: String,
  name: String,
  category: String,
  url: String,
  description: String,
  trending: Boolean,
  clicks: Number,
  logo: String
});

const Tool = mongoose.model("Tool", toolSchema);

// -------- IMPORT OLD JSON TOOLS --------
let jsonTools = [];

try {
  jsonTools = JSON.parse(fs.readFileSync("./data/tools.json","utf8"));
} catch {
  console.log("No tools.json found, skipping import");
}

async function importTools() {
  const count = await Tool.countDocuments();

  if (count === 0 && jsonTools.length > 0) {
    await Tool.insertMany(jsonTools);
    console.log("Default tools imported to MongoDB");
  }
}

importTools();
// --------------------------------------------------

const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const multer = require("multer");
const app = express();

// ---------- UPLOAD DIRECTORY ----------
const uploadDir = path.join(__dirname, "public/uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ---------- MIDDLEWARE ----------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

// ---------- FILE UPLOAD SETUP ----------
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./public/uploads");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage: storage });

// ---------- ROUTES ----------

// Test route
app.get("/test", (req,res)=>{
res.send("Server working");
});

// Home
app.get("/", async (req, res) => {

const tools = await Tool.find().limit(20);

res.render("home", { tools });

});

// CLICK TRACKING ROUTE
app.get("/visit/:id", async (req, res) => {

const tool = await Tool.findOne({ id: req.params.id });

if(!tool){
return res.redirect("/tools");
}

tool.clicks = (tool.clicks || 0) + 1;

await tool.save();

let redirectUrl = tool.url;

if(!redirectUrl.startsWith("http")){
redirectUrl = "https://" + redirectUrl;
}

return res.redirect(redirectUrl);

});

// 🔥 TRENDING PAGE
app.get("/trending", async (req, res) => {

const trendingTools = await Tool.find({})
.sort({ clicks: -1 })
.limit(10);

res.render("trending", { tools: trendingTools });

});

// Individual Tool Page
app.get("/tool/:id", async (req,res)=>{

const toolId = req.params.id;

const tool = await Tool.findOne({
$or: [
{ id: toolId },
{ name: new RegExp("^" + toolId + "$", "i") }
]
});

if(!tool){
return res.redirect("/tools");
}

res.render("tool",{tool});

});

// All tools
app.get("/tools", async (req,res)=>{

const tools = await Tool.find({});

// extract categories automatically
const categories = [...new Set(tools.map(t => t.category))];

res.render("tools",{tools, categories});

});

// Search
app.get("/search", async (req,res)=>{

const query = req.query.q || "";

const results = await Tool.find({
$or: [
{ name: { $regex: query, $options: "i" } },
{ category: { $regex: query, $options: "i" } },
{ description: { $regex: query, $options: "i" } }
]
});

res.render("tools",{tools:results});

});

// Submit page
app.get("/submit",function(req,res){
res.render("submit");
});

// Submit tool
app.post("/submit", upload.single("logo"), async (req, res) => {

const newTool = new Tool({
  id: req.body.name.toLowerCase().replace(/\s+/g, "-"),
  name: req.body.name,
  category: req.body.category,
  url: req.body.url,
  description: req.body.description,
  trending: false,
  clicks: 0,
  logo: req.file ? "/uploads/" + req.file.filename : ""
});

try {
  await newTool.save();
  console.log("Tool saved to MongoDB");
  res.redirect("/tools");
} catch(err) {
  console.log("Database error:", err);
  res.send("Error saving tool");
}

});

// About
app.get("/about",function(req,res){
res.render("about");
});

// Category filter
app.get("/tools/category/:name", async (req,res)=>{

const category = req.params.name;

const tools = await Tool.find({
category: { $regex: "^" + category + "$", $options: "i" }
});

res.render("tools",{tools});

});

// ---------- SERVER ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT,function(){
console.log("Server running on port " + PORT);
});
