async function testGemini() {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer AIzaSyDHGhsD4e8M2-_77G9fTJSbGgd0SXLONTM",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gemini-1.5-flash",
      messages: [
        { role: "user", content: "Say hello" }
      ]
    })
  });

  const data = await res.json();
  console.log(data.choices[0].message.content);
}

testGemini();