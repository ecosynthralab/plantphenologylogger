const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/classify-species');

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(data)
  };
}

async function classifyWithGriis(griisRecords, distributions) {
  const requestedUrls = [];
  global.fetch = async url => {
    requestedUrls.push(url);
    if (url.includes('/species/search?datasetKey=')) {
      return jsonResponse({ results: griisRecords });
    }
    if (url.includes('/distributions?')) {
      return jsonResponse({ results: distributions });
    }
    if (url.includes('/species/match?')) {
      return jsonResponse({ matchType: 'NONE' });
    }
    if (url.includes('query.wikidata.org')) {
      return jsonResponse({ results: { bindings: [] } });
    }
    if (url.includes('api.inaturalist.org')) {
      return jsonResponse({ results: [] });
    }
    throw new Error('Unexpected request: ' + url);
  };

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ name: 'Example plantus' })
  });
  assert.equal(response.statusCode, 200);
  return { result: JSON.parse(response.body), requestedUrls };
}

(async () => {
  const found = await classifyWithGriis(
    [{ key: 123, canonicalName: 'Example plantus', species: 'Example plantus' }],
    [{ country: 'NG', status: 'PRESENT', establishmentMeans: 'INVASIVE' }]
  );
  assert.equal(found.result.status, 'non-native');
  assert.equal(found.result.statusLabel, 'Non-native \u00b7 Invasive (GRIIS Nigeria)');
  assert.equal(found.result.sources.griis.checked, true);
  assert.match(found.result.sources.griis.note, /GRIIS Nigeria checklist/);
  assert.ok(found.requestedUrls.some(url => url.includes('datasetKey=1e049ac8-c0af-4ffe-aa7e-48a443c94635')));

  const notListed = await classifyWithGriis([], []);
  assert.equal(notListed.result.status, 'unknown');
  assert.equal(notListed.result.sources.griis.checked, true);
  assert.match(notListed.result.sources.griis.note, /does not establish native status/);

  console.log('PASS: GRIIS matches annotate species and missing records do not imply native status');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
