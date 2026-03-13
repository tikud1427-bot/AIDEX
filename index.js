const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();

const tools = JSON.parse(fs.readFileSync("./data/tools.json"));

// ---------- MIDDLEWARE ----------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

// ---------- DATABASE PATH ----------
const dataDir = path.join(__dirname, "data");
const dataPath = path.join(dataDir, "tools.json");

// ---------- DEFAULT TOOLS ----------
const defaultTools = [
{
id:"chatgpt",
name:"ChatGPT",
category:"Writing AI",
url:"https://chat.openai.com",
description:"AI chatbot for writing, coding and research.",
trending:true
},
{
id:"claude",
name:"Claude",
category:"Writing AI",
url:"https://claude.ai",
description:"Advanced AI assistant.",
trending:true
},
{
id:"grammarly",
name:"Grammarly",
category:"Writing AI",
url:"https://grammarly.com",
description:"AI grammar assistant.",
trending:false
},
{
id:"midjourney",
name:"Midjourney",
category:"Image AI",
url:"https://midjourney.com",
description:"AI art generator.",
trending:true
},
{
id:"dalle",
name:"DALL-E",
category:"Image AI",
url:"https://openai.com/dall-e",
description:"AI image generator.",
trending:true
}
];

let aiTools = [];

// ---------- LOAD DATABASE ----------
function loadTools(){

if(!fs.existsSync(dataDir)){
fs.mkdirSync(dataDir);
}

if(!fs.existsSync(dataPath)){
fs.writeFileSync(dataPath,JSON.stringify(defaultTools,null,2));
aiTools = defaultTools;
return;
}

try{
const data = fs.readFileSync(dataPath,"utf8");
aiTools = JSON.parse(data);
}
catch(err){
console.log("Error loading tools.json, resetting.");
aiTools = defaultTools;
saveTools();
}

}

// ---------- SAVE DATABASE ----------
function saveTools(){
fs.writeFileSync(dataPath,JSON.stringify(aiTools,null,2));
console.log("Tools saved");
}

// Load tools on start
loadTools();

// ---------- ROUTES ----------

// Test route
app.get("/test", (req,res)=>{
  res.send("Server working");
});

// Home
app.get("/", (req, res) => {

const categories = {};
const featuredTools = [];

aiTools.forEach(tool => {

if(!categories[tool.category]){
categories[tool.category] = 0;
}

if(categories[tool.category] < 5){
featuredTools.push(tool);
categories[tool.category]++;
}

});

res.render("home", { tools: featuredTools });

});

// Individual Tool Page
app.get("/tool/:id",(req,res)=>{

const toolId = req.params.id;

const tool = aiTools.find(t => t.id === toolId);

if(!tool){
return res.send("Tool not found");
}

res.render("tool",{tool});

});

// All tools
app.get("/tools",function(req,res){
res.render("tools",{tools:aiTools});
});

// Search
app.get("/search",(req,res)=>{

const query = req.query.q.toLowerCase();

const results = aiTools.filter(tool =>
tool.name.toLowerCase().includes(query) ||
tool.category.toLowerCase().includes(query) ||
tool.description.toLowerCase().includes(query)
);

res.render("tools",{tools:results});

});

// Trending
app.get("/trending",function(req,res){

const trendingTools = aiTools.filter(tool => tool.trending === true);

res.render("trending",{tools:trendingTools});

});

// Submit page
app.get("/submit",function(req,res){
res.render("submit");
});

// Submit tool
app.post("/submit",function(req,res){

const name = req.body.name;
const category = req.body.category;
const url = req.body.url;
const description = req.body.description;

if(!name || !category || !url || !description){
return res.send("All fields are required.");
}

let formattedUrl = url;

if(!url.startsWith("http")){
formattedUrl = "https://" + url;
}

// create id from name
const id = name.toLowerCase().replace(/\s+/g,"");

const newTool = {
id:id,
name:name,
category:category,
url:formattedUrl,
description:description,
trending:false
};

aiTools.push(newTool);

saveTools();

res.redirect("/tools");

});

// About
app.get("/about",function(req,res){
res.render("about");
});

// Category filter
app.get("/tools/category/:name",function(req,res){

const category = req.params.name.toLowerCase();

const filtered = aiTools.filter(tool =>
tool.category.toLowerCase() === category
);

res.render("tools",{tools:filtered});

});

// ---------- SERVER ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT,function(){
console.log("Server running on port " + PORT);
});
