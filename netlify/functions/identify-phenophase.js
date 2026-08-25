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

    // IMPORTANT: Netlify Functions have a hard 10-second execution limit on
    // the free tier (26s max even on Pro) — this cannot be configured away.
    // An earlier version of this function retried up to 3 times inside a
    // single invocation to smooth over Gemini's occasional 503s, but that
    // retry loop shares the SAME 10-second clock, so it could push the
    // whole request past the limit and get killed mid-flight — which shows
    // up client-side as an opaque "HTTP 502", a strictly worse failure than
    // the 503 it was trying to fix.
    //
    // Correct pattern: ONE attempt per invocation, bounded by an explicit
    // timeout well under 10s so Netlify's own limit is never what kills it.
    // If it fails, the client shows a clear message and the person taps the
    // button again — which is a genuinely fresh invocation with a fresh
    // 10-second clock, a safer retry than looping server-side.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);
    let geminiRes, data;
    try {
      geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: controller.signal
      });
      data = await geminiRes.json();
    } finally {
      clearTimeout(timeoutId);
    }

    if (!geminiRes.ok) {
      const geminiMessage = (data && data.error && data.error.message) || "No further detail from Gemini.";
      const friendly = geminiRes.status === 503
        ? "Gemini's free-tier model is temporarily overloaded \u2014 this is common and usually clears in a few seconds. Tap \"Read phenophase (AI)\" again."
        : geminiRes.status === 429
        ? "Gemini's free-tier rate limit was hit \u2014 wait about a minute, then try again."
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
    const timedOut = err.name === "AbortError";
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: timedOut
          ? "Gemini took too long to respond (over 9s) \u2014 tap \"Read phenophase (AI)\" again."
          : "Request to Gemini failed: " + err.message
      })
    };
  }
};
