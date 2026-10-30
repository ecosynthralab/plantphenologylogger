/*
 * speciesOrigin.js - resolves "Native / Introduced / Regional review needed" for the Phenology Logger.
 * Data: nigeria_origin_lookup.json (WCVP v16, Nigeria distribution; 5,940 accepted taxa + 27,095 synonyms).
 * Order of evidence:  1) your own saved reviews  ->  2) WCVP Nigeria record (name or synonym)  ->  3) "regional_review" (no Nigeria evidence).
 * Usage:
 *   await SpeciesOrigin.load('/nigeria_origin_lookup.json');
 *   const r = SpeciesOrigin.resolve('Vernonia amygdalina Del.');
 *   // r = { status:'native'|'introduced'|'regional_review', accepted, family, evidence, needsReview, confidence }
 *   SpeciesOrigin.saveReview('Mimosa diplotricha', 'introduced', 'Seen invading fallow at Awka; WCVP native S. America', 'C. Maduka');
 *   SpeciesOrigin.exportReviews();   // JSON string of all reviewer decisions, to merge into the curated table
 */
const SpeciesOrigin = (() => {
  let DB = null;
  const LS_KEY = 'speciesOriginReviews_v1';
  const reviews = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } };

  function normalise(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/×/g, 'x').replace(/\(.*?\)/g, ' ').replace(/\bcf\.?\b|\baff\.?\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    const p = s.split(' ');
    if (p.length < 2 || /^(sp|spp|sp\.|spp\.)$/i.test(p[1])) return null;   // genus-level: cannot be resolved
    const genus = p[0].charAt(0).toUpperCase() + p[0].slice(1).toLowerCase();
    const sp = p[1].toLowerCase();
    let infra = null;
    for (let i = 2; i < p.length - 1; i++) {
      if (/^(var|subsp|ssp|f)\.?$/i.test(p[i])) { infra = p[i].replace('.', '').toLowerCase().replace('ssp', 'subsp') + '. ' + p[i + 1].toLowerCase(); break; }
    }
    return { species: (genus + ' ' + sp).toLowerCase(), full: infra ? (genus + ' ' + sp + ' ' + infra).toLowerCase() : null };
  }

  async function load(url) {
    const r = await fetch(url || 'nigeria_origin_lookup.json');
    DB = await r.json();
    return DB;
  }

  function lookup(key) {
    if (DB.a[key]) return { acc: key, rec: DB.a[key], viaSynonym: false };
    const t = DB.s[key];
    if (t && DB.a[t]) return { acc: t, rec: DB.a[t], viaSynonym: true };
    return null;
  }

  function resolve(rawName) {
    const n = normalise(rawName);
    if (!n) return { status: 'regional_review', needsReview: true, evidence: 'Genus-level or unparseable name', confidence: 'none' };
    const saved = reviews()[n.species];
    if (saved) return { status: saved.status, needsReview: false, evidence: 'Reviewed: ' + saved.evidence, reviewer: saved.reviewer, date: saved.date, confidence: 'reviewed' };
    if (!DB) throw new Error('Call SpeciesOrigin.load() first');
    const hit = (n.full && lookup(n.full)) || lookup(n.species);
    if (!hit) return { status: 'regional_review', needsReview: true, accepted: null, evidence: 'No Nigeria record in WCVP v16 (species may be cultivated, absent from Nigeria, or a name problem)', confidence: 'none' };
    const [st, flags, family, accName, auth] = hit.rec;
    const doubtful = !!(flags & 2), extinct = !!(flags & 4);
    return {
      status: st === 1 ? 'introduced' : 'native',
      accepted: accName + ' ' + (auth || ''), family,
      needsReview: doubtful || extinct,
      evidence: 'WCVP v16: ' + (st === 1 ? 'introduced' : 'native') + ' in Nigeria' + (doubtful ? ' (location doubtful)' : '') + (extinct ? ' (extinct)' : '') + (hit.viaSynonym ? '; matched through synonym' : ''),
      confidence: doubtful || extinct ? 'low' : 'country-level'   // country-level only: not specific to south-east Nigeria
    };
  }

  function saveReview(name, status, evidence, reviewer) {
    const n = normalise(name); if (!n) throw new Error('Cannot review a genus-level name');
    if (!['native', 'introduced', 'invasive', 'cultivated', 'unknown'].includes(status)) throw new Error('status must be native|introduced|invasive|cultivated|unknown');
    if (!evidence || evidence.trim().length < 5) throw new Error('Give a short evidence note or citation');
    const all = reviews();
    all[n.species] = { status, evidence: evidence.trim(), reviewer: reviewer || '', date: new Date().toISOString().slice(0, 10) };
    localStorage.setItem(LS_KEY, JSON.stringify(all));
    return all[n.species];
  }

  const exportReviews = () => JSON.stringify(reviews(), null, 1);
  const queue = (names) => [...new Set(names)].map(n => ({ name: n, ...resolve(n) })).filter(r => r.needsReview);
  return { load, resolve, saveReview, exportReviews, queue, normalise };
})();
if (typeof module !== 'undefined') module.exports = SpeciesOrigin;
