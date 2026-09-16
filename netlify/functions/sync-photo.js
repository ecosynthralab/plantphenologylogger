// Netlify Function: authenticated photo storage for cross-device sync.
// The browser sends photo bytes here; the Supabase service-role key stays
// server-side and the shared sync passcode protects writes and deletes.

const BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'phenology-photos';
const PHOTO_ID = /^[A-Za-z0-9_-]+$/;

function response(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function ensureBucket(supabaseUrl, headers) {
  const res = await fetch(supabaseUrl + '/storage/v1/bucket', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 8388608 })
  });
  if (!res.ok && res.status !== 409) throw new Error('Could not initialize Supabase photo bucket: HTTP ' + res.status);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SYNC_SECRET = process.env.SYNC_SECRET;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SYNC_SECRET) {
    return response({ ok: false, error: 'photo sync is not configured on the server' });
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return response({ ok: false, error: 'invalid JSON body' }); }

  const { secret, action, photoId, base64, contentType } = payload || {};
  if (secret !== SYNC_SECRET) return response({ ok: false, error: 'wrong sync passcode' });
  if (!photoId || !PHOTO_ID.test(photoId)) return response({ ok: false, error: 'invalid photo id' });
  if (action !== 'upsert' && action !== 'delete' && action !== 'signed-url') return response({ ok: false, error: 'unknown action' });

  const url = SUPABASE_URL + '/storage/v1/object/' + encodeURIComponent(BUCKET) + '/' + encodeURIComponent(photoId);
  const headers = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + SERVICE_ROLE_KEY
  };

  try {
    if (action === 'upsert' || action === 'signed-url') await ensureBucket(SUPABASE_URL, headers);
    if (action === 'signed-url') {
      const res = await fetch(SUPABASE_URL + '/storage/v1/object/sign/' + encodeURIComponent(BUCKET) + '/' + encodeURIComponent(photoId), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 3600 })
      });
      if (!res.ok) return response({ ok: false, error: 'Supabase signed URL failed: HTTP ' + res.status });
      const data = await res.json();
      return response({ ok: true, url: SUPABASE_URL + '/storage/v1' + data.signedURL });
    }

    if (action === 'delete') {
      const res = await fetch(url, { method: 'DELETE', headers });
      if (!res.ok && res.status !== 404) return response({ ok: false, error: 'Supabase photo delete failed: HTTP ' + res.status });
      return response({ ok: true });
    }

    if (!base64) return response({ ok: false, error: 'base64 photo data is required' });
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return response({ ok: false, error: 'photo must be between 1 byte and 8 MB' });
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': contentType || 'image/jpeg', 'x-upsert': 'true' },
      body: bytes
    });
    if (!res.ok) {
      const text = await res.text();
      return response({ ok: false, error: 'Supabase photo upload failed: HTTP ' + res.status + ' ' + text.slice(0, 300) });
    }
    return response({ ok: true });
  } catch (e) {
    return response({ ok: false, error: e.message });
  }
};
