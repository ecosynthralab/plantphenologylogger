const assert = require('node:assert/strict');

(async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SYNC_SECRET = 'test-sync-secret';
  process.env.SUPABASE_PHOTO_BUCKET = 'test-photos';
  const { handler } = require('../netlify/functions/sync-photo');

  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200 };
  };

  const result = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      secret: 'test-sync-secret',
      action: 'delete',
      photoId: 'photo_123'
    })
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
  assert.equal(request.url, 'https://example.supabase.co/storage/v1/object/test-photos');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-service-role-key');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), { prefixes: ['photo_123'] });
  console.log('PASS: photo deletion uses the Supabase Storage remove endpoint');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
