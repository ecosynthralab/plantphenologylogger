// Netlify Function: the ONLY path that writes (upsert/delete) reach
// Supabase through. The browser never gets the service-role key — it lives
// here, server-side, as a Netlify environment variable — and every request
// must present the team's shared passcode (also an env var) before anything
// touches the database.
//
// Why this exists: the app's anon/publishable Supabase key is meant to be
// public — that part of the original review was a false alarm. The real
// problem was the RLS policies riding on that key ("public insert",
// "public update", eventually "public delete", all `using (true)`), which
// meant literally anyone who copied the key out of view-source could write
// or wipe the shared dataset, with nothing to distinguish a team member
// from a stranger. Routing writes through this function instead means:
//   - the anon key can now be locked down to SELECT only (see README)
//   - the service-role key (which bypasses RLS entirely) never leaves
//     the server
//   - a lightweight shared passcode is the only thing standing between
//     "found the URL" and "can write data", which is a much smaller/more
//     honest attack surface than "found the URL" alone.
//
// This intentionally does NOT use the @supabase/supabase-js SDK — the rest
// of this project's functions are zero-dependency (plain fetch against
// documented REST APIs), and Supabase's PostgREST endpoint doesn't need an
// SDK for two operations this simple.

const ALLOWED_TABLES = new Set(['observations', 'species']);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;

  // Fail closed: if the server-side env vars aren't configured, refuse
  // rather than silently falling back to something permissive.
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SYNC_SECRET) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'sync is not configured on the server (missing env vars)' })
    };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid JSON body' }) }; }

  const { secret, table, action, row, id } = payload || {};

  if (secret !== SYNC_SECRET) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'wrong sync passcode' }) };
  }
  if (!ALLOWED_TABLES.has(table)) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'unknown table' }) };
  }

  const baseHeaders = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  try {
    if (action === 'upsert') {
      if (!row || typeof row !== 'object' || !row.id) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'row with an id is required for upsert' }) };
      }
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: { ...baseHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row)
      });
      if (!res.ok) {
        const text = await res.text();
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Supabase upsert failed: HTTP ' + res.status + ' ' + text.slice(0, 300) }) };
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'delete') {
      if (!id) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'id is required for delete' }) };
      }
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { ...baseHeaders, 'Prefer': 'return=minimal' }
      });
      if (!res.ok) {
        const text = await res.text();
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Supabase delete failed: HTTP ' + res.status + ' ' + text.slice(0, 300) }) };
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'unknown action' }) };
  } catch (e) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
