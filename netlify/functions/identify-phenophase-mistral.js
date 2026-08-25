// Netlify Function: proxies the phenophase photo-ID request to Mistral's
// Pixtral vision model (free tier — no credit card required). Used as an
// automatic FALLBACK when the primary Gemini function fails — the client
// calls this one only if identify-phenophase.js errors out.
//
// Setup:
//  1. Get a free key at https://console.mistral.ai/api-keys (no card).
//  2. In Netlify: Site settings -> Environment variables
//     -> add MISTRAL_API_KEY = <your key>
//  3. Deploy.
//
// Free-tier notes:
//  - Uses pixtral-12b-2409, Mistral's vision-capable model.
//  - Mistral states API data is not used for model training — a cleaner
//    privacy stance than Gemini's free tier, worth knowing since these are
//    photos of real field sites.
//  - Rate limits are account-specific; check console.mistral.ai/limits.
//  - If MISTRAL_API_KEY isn't set, this function fails clearly rather than
//    silently — the fallback chain just won't have a second link until it's
//    configured, and Gemini alone still works exactly as before.

const MISTRAL_MODEL = "pixtral-12b-2409";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "not_configured",
        message: "MISTRAL_API_KEY is not set \u2014 fallback provider unavailable until it's added in Netlify environment variables."
      })
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

  // Same lesson as identify-phenophase.js: Netlify's free-tier functions
  // have a hard, non-configurable 10-second execution limit. One bounded
  // attempt, no internal retry loop — a client-side retry gets a fresh
  // 10-second clock, which is the safe way to retry.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const body = JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } }
          ]
        }
      ],
      max_tokens: 500
    });

    let mistralRes, data;
    try {
      mistralRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        body,
        signal: controller.signal
      });
      data = await mistralRes.json();
    } finally {
      clearTimeout(timeoutId);
    }

    if (!mistralRes.ok) {
      const mistralMessage = (data && data.message) || (data && data.error && data.error.message) || "No further detail from Mistral.";
      const friendly = mistralRes.status === 429
        ? "Mistral's free-tier rate limit was hit \u2014 wait a bit before trying again."
        : "Mistral error: " + mistralMessage;
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: friendly, mistralStatus: mistralRes.status, mistralMessage })
      };
    }

    const text = data?.choices?.[0]?.message?.content || "";

    // Normalize into the same {content: [{type:'text', text: ...}]} shape
    // the frontend already parses from the Gemini function, so the client
    // can treat both providers identically.
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text }], provider: "mistral" })
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const timedOut = err.name === "AbortError";
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: timedOut
          ? "Mistral took too long to respond (over 9s)."
          : "Request to Mistral failed: " + err.message
      })
    };
  }
};
