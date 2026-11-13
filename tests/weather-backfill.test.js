const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const backfill = html.slice(
  html.indexOf('// BACKFILL HISTORICAL WEATHER'),
  html.indexOf('// Pushes every locally-stored observation')
);
const weatherSource = html.slice(
  html.indexOf('const WMO_CODES ='),
  html.indexOf('// Live preview in the entry form')
);
assert(backfill.includes("getElementById('backfill-weather-btn')"));
assert(weatherSource.includes('async function fetchWeather'));

function makeRecord(id, overrides = {}) {
  return { id, visitDate: '2026-08-18', location: { lat: 6.25, lon: 7.01 }, ...overrides };
}

function makeHarness(records, options = {}) {
  const store = new Map(records.map(record => ['obs:' + record.id, structuredClone(record)]));
  const button = { textContent: '', disabled: false, addEventListener(_event, fn) { this.run = fn; } };
  const status = { textContent: '', style: {} };
  const lookups = [];
  const clears = [];
  const pushes = [];
  const context = {
    document: { getElementById: id => id === 'backfill-weather-btn' ? button : status },
    todayStr: () => '2026-11-13',
    validGps: (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180,
    fetchAllRecords: async () => [...store.values()].map(record => structuredClone(record)),
    lsGet: key => store.get(key),
    lsSet: (key, value) => {
      if (options.storageFailure === value.id) return false;
      store.set(key, value);
      return true;
    },
    fetchWeather: async (location, date) => {
      lookups.push([location, date]);
      if (options.onLookup) options.onLookup(store);
      return options.unavailable ? null : { temperatureC: 25, historical: true, source: 'Open-Meteo' };
    },
    SUPABASE_ENABLED: !!options.cloud,
    clearPushed: (table, id) => clears.push([table, id]),
    supabaseUpsert: async (table, record) => {
      pushes.push([table, record.id]);
      return options.syncFailure ? { ok: false, error: 'offline' } : { ok: true };
    },
    checkStorageHeadroom() {},
    refreshLog: async () => {},
    console
  };
  vm.runInNewContext(backfill, context);
  return { store, button, status, lookups, clears, pushes };
}

(async () => {
  const harness = makeHarness([
    makeRecord('a'),
    makeRecord('b', { weatherSoil: 'soil moist' }),
    makeRecord('existing', { weather: { precipitationMm: 0 } }),
    makeRecord('no-location', { location: null }),
    makeRecord('bad-date', { visitDate: '2026-02-30' }),
    makeRecord('today', { visitDate: '2026-11-13' })
  ], { cloud: true });
  await harness.button.run();
  assert.equal(harness.lookups.length, 1, 'same date and coordinates share a lookup');
  assert.equal(harness.store.get('obs:a').weather.temperatureC, 25);
  assert.equal(harness.store.get('obs:b').weatherSoil, 'soil moist');
  assert.deepEqual(harness.store.get('obs:existing').weather, { precipitationMm: 0 });
  assert.equal(harness.pushes.length, 2);
  assert.equal(harness.clears.length, 2);
  assert.match(harness.status.textContent, /updated 2; kept existing weather on 1; skipped 3/);
  await harness.button.run();
  assert.equal(harness.lookups.length, 1, 'repeat runs do not overwrite existing weather');
  assert.match(harness.status.textContent, /updated 0; kept existing weather on 3/);
  assert.equal(harness.button.disabled, false);

  const unavailable = makeHarness([makeRecord('a'), makeRecord('b')], { unavailable: true });
  await unavailable.button.run();
  assert.equal(unavailable.lookups.length, 1);
  assert.match(unavailable.status.textContent, /2 unavailable from Open-Meteo/);
  assert.equal(unavailable.store.get('obs:a').weather, undefined);

  const storage = makeHarness([makeRecord('a')], { cloud: true, storageFailure: 'a' });
  await storage.button.run();
  assert.match(storage.status.textContent, /1 could not be saved locally/);
  assert.equal(storage.pushes.length, 0);

  const sync = makeHarness([makeRecord('a')], { cloud: true, syncFailure: true });
  await sync.button.run();
  assert.match(sync.status.textContent, /1 could not sync/);
  assert.equal(sync.clears.length, 1, 'failed sync remains eligible for bulk push');
  assert.equal(sync.store.get('obs:a').weather.temperatureC, 25);

  const changed = makeHarness([makeRecord('a')], {
    onLookup: store => { store.get('obs:a').weather = { conditions: 'Observed rain' }; }
  });
  await changed.button.run();
  assert.equal(changed.store.get('obs:a').weather.conditions, 'Observed rain');
  assert.match(changed.status.textContent, /1 changed during lookup/);

  const weatherContext = {
    todayStr: () => '2026-11-13',
    validGps: () => true,
    AbortController, setTimeout, clearTimeout, console,
    fetch: async url => {
      assert.match(url, /archive-api\.open-meteo\.com/);
      return { ok: true, json: async () => ({
        hourly: {
          time: ['2026-08-18T11:00', '2026-08-18T12:00'],
          temperature_2m: [20, 25],
          weather_code: [0, 3]
        }
      }) };
    }
  };
  vm.runInNewContext(weatherSource, weatherContext);
  const weather = await weatherContext.fetchWeather({ lat: 6.25, lon: 7.01 }, '2026-08-18');
  assert.equal(weather.temperatureC, 25);
  assert.equal(weather.observedAt, '2026-08-18T12:00');
  assert.equal(weather.conditions, 'Overcast');

  const exportSource = html.slice(
    html.indexOf("document.getElementById('export-csv').addEventListener"),
    html.indexOf('// Only refresh (and build the chart)')
  );
  const callbacks = {};
  const sheets = {};
  let csvBlob;
  const exportContext = {
    document: {
      getElementById: id => ({ addEventListener: (_event, fn) => { callbacks[id] = fn; } }),
      createElement: () => ({ click() {} })
    },
    fetchAllRecords: async () => [
      makeRecord('historical', { weather: { historical: true, observedAt: '2026-08-18T12:00', source: 'Open-Meteo' } }),
      makeRecord('current', { weather: { historical: false, observedAt: '2026-11-13T10:00', source: 'Open-Meteo' } }),
      makeRecord('none')
    ],
    allSpecies: () => [],
    todayStr: () => '2026-11-13',
    Blob,
    URL: { createObjectURL: blob => { csvBlob = blob; return 'blob:test'; } },
    XLSX: {
      utils: {
        book_new: () => ({}),
        json_to_sheet: rows => rows,
        book_append_sheet: (_book, rows, name) => { sheets[name] = rows; }
      },
      writeFile() {}
    }
  };
  vm.runInNewContext(exportSource, exportContext);
  await callbacks['export-csv']();
  const csv = (await csvBlob.text()).split('\n').map(line => line.split(','));
  const headers = csv[0];
  assert.equal(csv[1][headers.indexOf('weatherObservedAt')], '2026-08-18T12:00');
  assert.equal(csv[1][headers.indexOf('weatherSource')], 'Open-Meteo');
  assert.equal(csv[1][headers.indexOf('weatherHistorical')], 'true');
  assert.equal(csv[2][headers.indexOf('weatherHistorical')], 'false');
  assert.equal(csv[3][headers.indexOf('weatherHistorical')], '');
  await callbacks['export-xlsx']();
  assert.equal(sheets.Observations[0]['Weather Observed At'], '2026-08-18T12:00');
  assert.equal(sheets.Observations[0]['Weather Source'], 'Open-Meteo');
  assert.equal(sheets.Observations[0]['Weather Historical'], true);
  assert.equal(sheets.Observations[1]['Weather Historical'], false);
  assert.equal(sheets.Observations[2]['Weather Historical'], '');

  const realtimeSource = html.slice(
    html.indexOf('function supabaseSubscribeRealtime()'),
    html.indexOf('// STORAGE SHIM')
  );
  const handlers = {};
  const channel = {
    on: (_event, filter, callback) => { handlers[filter.table] = callback; return channel; },
    subscribe: () => channel
  };
  let local = makeRecord('a', { savedAt: '2026-08-18', weather: { temperatureC: 25 } });
  let pushed = {};
  let syncMessage = '';
  const realtimeContext = {
    SUPABASE_ENABLED: true,
    supabaseClient: { channel: () => channel },
    lsGet: () => local,
    lsSet: (_key, value) => { local = value; return true; },
    getPushedIds: () => pushed,
    hasRecordedWeather: value => !!value && value.temperatureC != null,
    remoteIsNewer: (remote, original) => remote.savedAt > original.savedAt,
    setSyncStatus: (_state, message) => { syncMessage = message; },
    document: { getElementById: () => ({ classList: { contains: () => false } }) }
  };
  vm.runInNewContext(realtimeSource, realtimeContext);
  realtimeContext.supabaseSubscribeRealtime();
  const remote = makeRecord('a', { savedAt: '2026-11-13', weather: null });
  handlers.observations({ eventType: 'UPDATE', new: remote });
  assert.equal(local.weather.temperatureC, 25);
  assert.match(syncMessage, /unsynced local weather update was kept/);
  pushed = { a: true };
  handlers.observations({ eventType: 'UPDATE', new: remote });
  assert.equal(local.weather, null, 'synced records still accept remote changes');
  handlers.observations({ eventType: 'UPDATE', new: makeRecord('a', { weather: { temperatureC: 22 } }) });
  assert.equal(local.weather.temperatureC, 22);
  console.log('PASS: historical weather backfill and noon lookup');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
