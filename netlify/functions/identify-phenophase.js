// Netlify Function: proxies the phenophase photo-ID request to Google's Gemini API
// (free tier — no credit card required). Keeps GEMINI_API_KEY server-side so it's
// never exposed to the browser.
//
// Setup:
//  1. Get a free key at https://aistudio.google.com -> "Get API key"
//     (Google account required, no credit card).
//  2. In the Netlify dashboard: Site settings -> Environment variables
//     -> add GEMINI_API_KEY = <your key>
//  3. Deploy. Netlify auto-detects functions in netlify/functions/.
//
// Free-tier notes:
//  - Uses the "gemini-flash-latest" alias, which Google automatically points
//    at its current free-tier Flash model. This avoids the function breaking
//    every time Google retires a specific dated model name (e.g. 2.5-flash).
//  - Roughly 1,000-1,500 requests/day, 10-15 requests/minute depending on
//    the model behind the alias — plenty for field use.
//  - No expiration, no card. Google may use free-tier prompts to improve
//    their products, so avoid submitting anything sensitive.
//  - If you ever outgrow this, enabling billing on the same project raises
//    the limits — nothing else in this function needs to change.

const GEMINI_MODEL = "gemini-flash-latest";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "GEMINI_API_KEY is not set in Netlify environment variables." })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { mediaType, imageBase64, prompt } = payload;
  if (!mediaType || !imageBase64 || !prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: "mediaType, imageBase64, and prompt are required" }) };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const body = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mediaType, data: imageBase64 } }
          ]
        }
      ],
      generationConfig: { maxOutputTokens: 1000 }
    });

    // Gemini's free-tier Flash alias occasionally returns 503 ("model
    // overloaded") under load — this is transient, not a real failure, so
    // retry a couple of times with a short backoff before giving up.
    let geminiRes, data;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body
      });
      data = await geminiRes.json();
      if (geminiRes.ok) break;
      const isOverloaded = geminiRes.status === 503 || geminiRes.status === 429;
      if (isOverloaded && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, attempt * 800));
        continue;
      }
      break;
    }

    if (!geminiRes.ok) {
      const geminiMessage = (data && data.error && data.error.message) || "No further detail from Gemini.";
      const friendly = geminiRes.status === 503
        ? "Gemini's free-tier model is temporarily overloaded (this is common and usually clears in a few seconds) \u2014 tried 3 times, still busy. Wait a moment and try again."
        : geminiRes.status === 429
        ? "Gemini's free-tier rate limit was hit \u2014 wait a minute before trying again."
        : "Gemini error: " + geminiMessage;
      return {
        statusCode: 200, // return 200 so the client can read the friendly message instead of a bare HTTP error
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: friendly, geminiStatus: geminiRes.status, geminiMessage })
      };
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";

    // Normalize into the same {content: [{type:'text', text: ...}]} shape
    // the frontend already parses, so index.html needs no changes.
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text }] })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Request to Gemini failed: " + err.message })
    };
  }
};
