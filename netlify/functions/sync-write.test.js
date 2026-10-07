const assert = require('node:assert/strict');
const { handler } = require('./sync-write');

(async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SYNC_SECRET = 'test-sync-secret';

  const uploadedBodies = [];
  let requestNumber = 0;
  global.fetch = async (_url, options) => {
    requestNumber += 1;
    uploadedBodies.push(JSON.parse(options.body));
    if (requestNumber === 1) {
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          code: 'PGRST204',
          message: "Could not find the 'imgIsThumbnailFallback' column of 'species' in the schema cache"
        })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true })
    };
  };

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      secret: 'test-sync-secret',
      table: 'species',
      action: 'upsert',
      row: {
        id: 'species-1',
        common: 'Example species',
        sci: 'Example species',
        img: 'cover_photo_1',
        imgIsThumbnailFallback: false,
        localNamesByLanguage: { ig: [], yo: [], ha: [] }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, JSON.stringify({
    ok: true,
    warning: 'Species synced; omitted imgIsThumbnailFallback because the remote schema does not contain that local-only field.'
  }));
  assert.equal(uploadedBodies.length, 2);
  assert.equal('imgIsThumbnailFallback' in uploadedBodies[0], true);
  assert.equal('imgIsThumbnailFallback' in uploadedBodies[1], false);
  assert.equal('localNamesByLanguage' in uploadedBodies[1], true);
  console.log('PASS: missing imgIsThumbnailFallback column is omitted on retry');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
