// Netlify Function: hands the browser the two PUBLIC Supabase values
// (project URL + anon key) at runtime. These are safe to expose — the
// anon key is designed to be public (see sync-write.js) — the browser
// just has no other way to read Netlify environment variables, since
// this site has no build step (no Vite/webpack) to inject them at
// build time. Do NOT put the service-role key or SYNC_SECRET here.

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      SUPABASE_URL: process.env.SUPABASE_URL || null,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || null
    })
  };
};
