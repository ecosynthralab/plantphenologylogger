// Netlify Function: identifies a plant species from a photo using the
// Pl@ntNet API (https://my.plantnet.org/doc/api/identify).
//
// The API key is read from the PLANTNET_API_KEY environment variable —
// never hardcoded here, so it's safe even if this repo is public. Set it
// in Netlify: Site settings → Environment variables → PLANTNET_API_KEY.
//
// Project is fixed to "all" (Pl@ntNet's worldwide flora, backed by
// k-world-flora) since Pl@ntNet doesn't currently offer a West-Africa-
// specific regional project the way it does for e.g. Western Europe or
// Canada — "all" is the correct choice here, not a fallback.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.PLANTNET_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "not_configured",
        message: "PLANTNET_API_KEY is not set in this Netlify site's environment variables. Species photo-ID is unavailable until it's added."
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { imageBase64, mediaType, organ } = payload;
  if (!imageBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: "imageBase64 is required" }) };
  }

  try {
    const buffer = Buffer.from(imageBase64, "base64");
    const blob = new Blob([buffer], { type: mediaType || "image/jpeg" });

    const form = new FormData();
    form.append("images", blob, "photo.jpg");
    form.append("organs", organ || "auto");

    const url = "https://my-api.plantnet.org/v2/identify/all?api-key=" + encodeURIComponent(apiKey) + "&lang=en";
    const res = await fetch(url, { method: "POST", body: form });
    const text = await res.text();

    if (!res.ok) {
      let reason = text;
      try { reason = JSON.parse(text).message || text; } catch (e) { /* keep raw text */ }
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "plantnet_error", message: "Pl@ntNet returned an error: " + reason })
      };
    }

    const data = JSON.parse(text);
    const results = (data.results || []).slice(0, 5).map(r => ({
      scientificName: r.species.scientificNameWithoutAuthor,
      family: r.species.family ? r.species.family.scientificNameWithoutAuthor : null,
      commonNames: r.species.commonNames || [],
      score: r.score
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results,
        predictedOrgan: (data.predictedOrgans && data.predictedOrgans[0] && data.predictedOrgans[0].organ) || null,
        remainingRequestsToday: data.remainingIdentificationRequests != null ? data.remainingIdentificationRequests : null
      })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "request_failed", message: err.message })
    };
  }
};
