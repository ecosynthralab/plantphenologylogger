// Netlify Function: classifies a species as native/non-native/unconfirmed
// for Nigeria, and attaches any local-language names found.
//
// Lookup order:
//   1. The West African regional species table (bundled JSON) — Nigeria-
//      specific status only; "not recorded" never implies absence. Any
//      curator_note on a record is appended to the note shown.
//   2. WCVP v16 Nigeria distribution (bundled) — country-level native /
//      introduced, used when 1 does not resolve. Doubtful/extinct records
//      are left for review.
//   3. GRIIS Nigeria checklist (published through GBIF) — independent
//      evidence for introduced/invasive status; absence is not evidence
//      of native status.
//   4. GBIF (official, documented API — https://techdocs.gbif.org/en/openapi/)
//      — species/match to resolve the name, then /species/{key}/distributions
//      for establishmentMeans. Used only when earlier sources do not resolve status.
//      This REPLACES the old POWO scrape entirely — POWO has no official API
//      (confirmed: IPNI's own site states "there is no publicly available
//      API"), so it's no longer called live at all.
//   5. Wikidata SPARQL (official, documented) — best-effort lookup for any
//      local-language common names (P1843) in Yoruba/Igbo/Hausa. Coverage is
//      genuinely sparse for West African plants as of this writing — this
//      is a bonus layer, not a primary source, and is never allowed to slow
//      down or fail the main classification.

const NIGERIA_HINTS = [
  "nigeria", "w. trop. africa", "west tropical africa", "west africa",
  "guinea", "tropical africa", "trop. africa", "trop. & subtrop. africa",
  "s. tropical africa", "c. tropical africa", "e. tropical africa"
];
const LOCAL_LANGUAGES = { ig: "Igbo", yo: "Yoruba", ha: "Hausa" };
const AFRICAN_ISO2 = new Set("DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW RE YT SH EH".split(" "));
const APP_USER_AGENT = "Ecosynthra-Phenology-Logger/1.0 (species classification; contact site maintainer)";
const GRIIS_NIGERIA_DATASET_KEY = "1e049ac8-c0af-4ffe-aa7e-48a443c94635";
const REGIONAL_SPECIES = require("../../Species list/phenology_logger_species_database.json");
const WCVP_NIGERIA = require("../../Species list/nigeria_origin_lookup.json");

function normalizeName(name) {
  return (name || "").toLowerCase().replace(/\s*\(.*?\)/g, "").replace(/\bcf\.?\b/gi, "").replace(/\s+/g, " ").trim();
}

function regionalNameKey(name) {
  return normalizeName(name).split(" ").slice(0, 2).join(" ");
}

const REGIONAL_SPECIES_BY_NAME = new Map();
const REGIONAL_SPECIES_ALIASES = new Map();

REGIONAL_SPECIES.forEach(species => {
  REGIONAL_SPECIES_BY_NAME.set(regionalNameKey(species.accepted_name), species);
  (species.names_in_lists || "").split("|").forEach(alias => {
    const key = regionalNameKey(alias);
    if (!key || REGIONAL_SPECIES_BY_NAME.has(key)) return;
    const existing = REGIONAL_SPECIES_ALIASES.get(key);
    if (REGIONAL_SPECIES_ALIASES.has(key) && existing && existing.species_id !== species.species_id) {
      REGIONAL_SPECIES_ALIASES.set(key, null);
    } else if (!REGIONAL_SPECIES_ALIASES.has(key)) {
      REGIONAL_SPECIES_ALIASES.set(key, species);
    }
  });
});

function lookupRegional(name) {
  const key = regionalNameKey(name);
  return REGIONAL_SPECIES_BY_NAME.get(key) || REGIONAL_SPECIES_ALIASES.get(key) || null;
}

// WCVP v16 Nigeria distribution: record = [status 0 native/1 introduced, flags (2 doubtful, 4 extinct), family, accepted name, authority]
function lookupWcvp(name) {
  const norm = normalizeName(name).replace(/\u00d7/g, "x");
  const parts = norm.split(" ");
  if (parts.length < 2 || /^spp?\.?$/.test(parts[1])) return null;
  const keys = [];
  for (let i = 2; i < parts.length - 1; i++) {
    if (/^(var|subsp|ssp|f)\.?$/.test(parts[i])) {
      keys.push(parts[0] + " " + parts[1] + " " + parts[i].replace(".", "").replace("ssp", "subsp") + ". " + parts[i + 1]);
      break;
    }
  }
  keys.push(parts[0] + " " + parts[1]);
  for (const key of keys) {
    let acc = key, viaSynonym = false;
    if (!WCVP_NIGERIA.a[acc]) {
      acc = WCVP_NIGERIA.s[key];
      viaSynonym = true;
    }
    const rec = acc && WCVP_NIGERIA.a[acc];
    if (rec) return { rec, viaSynonym, status: rec[0], doubtful: !!(rec[1] & 2), extinct: !!(rec[1] & 4), family: rec[2], accepted: rec[3], authority: rec[4] };
  }
  return null;
}

async function safeFetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json", "User-Agent": APP_USER_AGENT }
    });
    clearTimeout(timer);
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    if (!res.ok) return { ok: false, reason: "HTTP " + res.status + " from " + new URL(url).hostname };
    if (!contentType.includes("json") && text.trim().startsWith("<")) {
      return { ok: false, reason: new URL(url).hostname + " returned HTML instead of JSON" };
    }
    try { return { ok: true, data: JSON.parse(text) }; }
    catch (e) { return { ok: false, reason: "Could not parse JSON from " + new URL(url).hostname }; }
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: err.name === "AbortError" ? "Request timed out" : err.message };
  }
}

// Best-effort local-name lookup via Wikidata SPARQL (official, documented).
// Never throws, never blocks the main result if it fails or finds nothing.
// Returns two distinct things from the same query: an English common name
// (commonName) and any Yoruba/Igbo/Hausa names (names) \u2014 previously the
// query asked Wikidata for "en" results too but then discarded them,
// leaving the app with no real common name at all (every compendium entry
// ended up with common === sci, since the client had nothing else to use).
async function lookupLocalNames(scientificName) {
  const query = `
    SELECT ?name ?nameLang WHERE {
      ?taxon wdt:P225 "${scientificName.replace(/"/g, '')}".
      ?taxon p:P1843 ?stmt.
      ?stmt ps:P1843 ?name.
      BIND(LANG(?name) AS ?nameLang)
      FILTER(?nameLang IN ("yo","ig","ha","en"))
    } LIMIT 15
  `;
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  const result = await safeFetchJson(url, 6000);
  if (!result.ok) {
    const fallback = await lookupWikidataApiNames(scientificName);
    if (fallback.checked) return fallback;
    return { checked: false, names: [], namesByLanguage: { ig: [], yo: [], ha: [] }, commonName: null, note: "Wikidata lookup failed: " + result.reason + "; API fallback: " + fallback.note };
  }
  const bindings = (result.data.results && result.data.results.bindings) || [];
  const names = bindings
    .filter(b => ["yo", "ig", "ha"].includes(b.nameLang.value))
    .map(b => `${b.name.value} (${b.nameLang.value})`);
  const namesByLanguage = { ig: [], yo: [], ha: [] };
  bindings.forEach(b => {
    if (namesByLanguage[b.nameLang.value]) namesByLanguage[b.nameLang.value].push(b.name.value);
  });
  Object.keys(namesByLanguage).forEach(lang => { namesByLanguage[lang] = [...new Set(namesByLanguage[lang])]; });
  const englishNames = [...new Set(bindings.filter(b => b.nameLang.value === "en").map(b => b.name.value))];
  const commonName = englishNames[0] || null;
  const noteParts = [];
  if (names.length) noteParts.push("Local names found on Wikidata: " + [...new Set(names)].join(", "));
  if (commonName) noteParts.push("English common name: " + commonName + (englishNames.length > 1 ? " (also: " + englishNames.slice(1).join(", ") + ")" : ""));
  return {
    checked: true,
    names: [...new Set(names)],
    namesByLanguage,
    commonName,
    note: noteParts.length
      ? noteParts.join(" \u2014 ")
      : "No Yoruba/Igbo/Hausa or English common names found on Wikidata for this taxon \u2014 coverage for West African plants is generally sparse there; check Burkill's Useful Plants of West Tropical Africa or NMPPDB instead."
  };
}

async function lookupWikidataApiNames(scientificName) {
  const searchUrl = "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=" + encodeURIComponent(scientificName) + "&language=en&format=json&limit=1";
  const search = await safeFetchJson(searchUrl, 6000);
  const entityId = search.ok && search.data.search && search.data.search[0] && search.data.search[0].id;
  if (!entityId) return { checked: false, names: [], namesByLanguage: { ig: [], yo: [], ha: [] }, commonName: null, note: search.ok ? "Wikidata API found no matching taxon." : search.reason };

  const entityUrl = "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=" + encodeURIComponent(entityId) + "&props=claims|labels&languages=en|ig|yo|ha&format=json";
  const entityResult = await safeFetchJson(entityUrl, 6000);
  const entity = entityResult.ok && entityResult.data.entities && entityResult.data.entities[entityId];
  if (!entity) return { checked: false, names: [], namesByLanguage: { ig: [], yo: [], ha: [] }, commonName: null, note: "Wikidata API entity lookup failed." };

  const namesByLanguage = { ig: [], yo: [], ha: [] };
  const claims = entity.claims && entity.claims.P1843 || [];
  claims.forEach(claim => {
    const value = claim.mainsnak && claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
    if (!value || typeof value !== "object" || !namesByLanguage[value.language]) return;
    if (value.text) namesByLanguage[value.language].push(value.text);
  });
  Object.keys(namesByLanguage).forEach(lang => { namesByLanguage[lang] = [...new Set(namesByLanguage[lang])]; });
  const commonName = entity.labels && entity.labels.en ? entity.labels.en.value : null;
  const names = Object.keys(namesByLanguage).flatMap(lang => namesByLanguage[lang].map(name => `${name} (${lang})`));
  return {
    checked: true,
    names,
    namesByLanguage,
    commonName,
    note: names.length ? "Wikidata API fallback found regional names." : "Wikidata API found the taxon but no Igbo, Yoruba, or Hausa P1843 names."
  };
}

async function lookupGbifVernacularNames(usageKey) {
  if (!usageKey) return { checked: false, names: [], namesByLanguage: {}, note: "No GBIF usage key available" };
  const url = "https://api.gbif.org/v1/species/" + encodeURIComponent(usageKey) + "/vernacularNames?limit=100";
  const result = await safeFetchJson(url, 7000);
  if (!result.ok) return { checked: false, names: [], namesByLanguage: {}, note: "GBIF vernacular-name lookup failed: " + result.reason };
  const rows = (result.data && result.data.results) || [];
  const namesByLanguage = { ig: [], yo: [], ha: [] };
  rows.forEach(row => {
    const lang = (row.language || "").toLowerCase();
    if (namesByLanguage[lang] && row.vernacularName) namesByLanguage[lang].push(row.vernacularName);
  });
  Object.keys(namesByLanguage).forEach(lang => { namesByLanguage[lang] = [...new Set(namesByLanguage[lang])]; });
  return {
    checked: true,
    names: rows.map(row => row.vernacularName).filter(Boolean),
    namesByLanguage,
    note: rows.length ? "GBIF vernacular names checked." : "GBIF has no vernacular names for this taxon."
  };
}

async function lookupGriisNigeria(name) {
  const cleanName = name.replace(/\(.*?\)/g, "").replace(/\bcf\.?\b/gi, "").trim();
  const searchUrl = "https://api.gbif.org/v1/species/search?datasetKey=" +
    GRIIS_NIGERIA_DATASET_KEY + "&q=" + encodeURIComponent(cleanName) + "&limit=10";
  const search = await safeFetchJson(searchUrl, 7000);
  if (!search.ok) {
    return { checked: false, found: false, note: "GRIIS Nigeria checklist lookup failed: " + search.reason };
  }

  const queryKey = regionalNameKey(cleanName);
  const records = (search.data && search.data.results) || [];
  const match = records.find(record =>
    [record.canonicalName, record.species].some(candidate =>
      candidate && regionalNameKey(candidate) === queryKey
    )
  );
  if (!match) {
    return {
      checked: true,
      found: false,
      note: "No exact species match in the GRIIS Nigeria checklist; absence from the checklist does not establish native status."
    };
  }

  const distributionUrl = "https://api.gbif.org/v1/species/" +
    encodeURIComponent(match.key) + "/distributions?limit=100";
  const distribution = await safeFetchJson(distributionUrl, 7000);
  if (!distribution.ok) {
    return {
      checked: true,
      found: true,
      name: match.canonicalName || match.species || cleanName,
      establishmentMeans: null,
      note: "Listed in the GRIIS Nigeria checklist, but its distribution detail could not be retrieved: " + distribution.reason
    };
  }

  const rows = (distribution.data && distribution.data.results) || [];
  const nigeriaRecord = rows.find(row =>
    row.country === "NG" || (row.locality || "").toLowerCase().includes("nigeria")
  );
  const means = (nigeriaRecord && nigeriaRecord.establishmentMeans || "").toUpperCase();
  const statusDescription = means
    ? "Nigeria establishment means: " + means + "."
    : "The checklist entry does not specify establishment means.";

  return {
    checked: true,
    found: true,
    name: match.canonicalName || match.species || cleanName,
    establishmentMeans: means || null,
    note: "Listed in the GRIIS Nigeria checklist of introduced and invasive alien species. " + statusDescription
  };
}

async function lookupINaturalist(scientificName) {
  const url = "https://api.inaturalist.org/v1/taxa?q=" + encodeURIComponent(scientificName) + "&rank=species&per_page=1";
  const result = await safeFetchJson(url, 7000);
  if (!result.ok) return { checked: false, commonName: null, note: "iNaturalist lookup failed: " + result.reason };
  const taxon = result.data && result.data.results && result.data.results[0];
  if (!taxon) return { checked: true, commonName: null, note: "iNaturalist found no matching taxon." };
  return {
    checked: true,
    commonName: taxon.preferred_common_name || (taxon.english_common_names || [])[0] || null,
    matchedName: taxon.name || null,
    note: "iNaturalist taxon match checked."
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) }; }

  const rawName = (payload.name || "").trim();
  if (!rawName) return { statusCode: 400, body: JSON.stringify({ error: "name is required" }) };

  const result = {
    queriedName: rawName, matchedName: null, family: null,
    status: "unknown", statusLabel: "Regional review needed", origin: "\u2014",
    note: "The taxon was matched, but available sources did not resolve Nigeria-specific status with enough evidence. Regional review is needed; no native/non-native claim is being invented.",
    commonName: null,
    localNames: [],
    localNamesByLanguage: { ig: [], yo: [], ha: [] },
    classification: null,
    sources: {
      curated: { checked: false, note: "Not in the curated West African species table" },
      gbif: { checked: false, note: "Not queried" },
      griis: { checked: false, note: "Not queried" },
      inaturalist: { checked: false, note: "Not queried by automated lookup \u2014 cross-check manually" },
      wikidata: { checked: false, note: "Not queried" }
    }
  };
  let gbifUsageKey = null;
  let statusSource = null;
  const griisPromise = lookupGriisNigeria(rawName);

  // ---- 1. Regional species table (instant, no network) ----
  const regional = lookupRegional(rawName);
  const regionalStatus = regional && regional.nigeria_status;
  const useRegional = regional && ["Native", "Introduced"].includes(regionalStatus);
  const wcvp = lookupWcvp(rawName);
  const useWcvp = !!wcvp && !useRegional && !wcvp.doubtful && !wcvp.extinct;
  // POWO has no public API; its underlying dataset (WCVP) is bundled, so report that.
  result.sources = {
    curated: result.sources.curated,
    powo: wcvp
      ? { checked: true, note: "WCVP v16 (the dataset behind Kew POWO) records this taxon as " + (wcvp.status === 0 ? "native" : "introduced") + " in Nigeria" + (wcvp.doubtful ? " (location doubtful)" : "") + (wcvp.extinct ? " (extinct)" : "") + (wcvp.viaSynonym ? ", matched through a synonym" : "") + "." }
      : { checked: true, note: "No Nigeria record in the bundled WCVP v16 (the dataset behind Kew POWO). POWO has no public API \u2014 check powo.science.kew.org manually." },
    ...Object.fromEntries(Object.entries(result.sources).filter(([k]) => k !== "curated"))
  };

  if (useRegional) {
    statusSource = "curated";
    const native = regionalStatus === "Native";
    const statusLabel = native ? "Native · Indigenous (regional table)" : "Non-native · Introduced (regional table)";
    const hasNamedSources = regional.sources && !/^S\d+(?:,\s*S\d+)*$/.test(regional.sources);
    const sourceNote = hasNamedSources
      ? "Sources: " + regional.sources + "."
      : "Hand-verified against POWO; WCVP plant name ID: " + regional.wcvp_plant_name_id + ".";
    result.matchedName = regional.accepted_name;
    result.family = regional.family || null;
    result.status = native ? "native" : "non-native";
    result.statusLabel = statusLabel;
    result.origin = regional.origin_category || "Nigeria status recorded in the regional table";
    result.note = "The regional species table records Nigeria status as " + regionalStatus + ". Wider West Tropical African status: " + regional.wta_status + "." +
      (regional.curator_note ? " " + regional.curator_note : "");
    result.sources.curated = {
      checked: true,
      note: "Matched against the curated West African species table. " + sourceNote + " Nigeria status: " + regionalStatus + "."
    };

    try {
      const classifyUrl = "https://api.gbif.org/v1/species/match?name=" + encodeURIComponent(result.matchedName) + "&kingdom=Plantae";
      const classifyMatch = await safeFetchJson(classifyUrl, 7000);
      if (classifyMatch.ok && classifyMatch.data && classifyMatch.data.usageKey) {
        const g = classifyMatch.data;
        gbifUsageKey = g.usageKey;
        result.classification = {
          kingdom: g.kingdom || null, phylum: g.phylum || null, class: g.class || null,
          order: g.order || null, family: g.family || result.family, genus: g.genus || null,
          species: g.species || result.matchedName
        };
      }
    } catch (e) { /* classification is a nice-to-have; the regional status is already available */ }
  } else if (useWcvp) {
    statusSource = "wcvp";
    const native = wcvp.status === 0;
    result.matchedName = wcvp.accepted;
    result.family = wcvp.family || null;
    result.status = native ? "native" : "non-native";
    result.statusLabel = native ? "Native · Indigenous (WCVP)" : "Non-native · Introduced (WCVP)";
    result.origin = "Nigeria distribution record in WCVP v16";
    result.note = "WCVP v16 (Kew) records this taxon as " + (native ? "native" : "introduced") + " in Nigeria" +
      (wcvp.viaSynonym ? "; matched through a synonym of " + wcvp.accepted + (wcvp.authority ? " " + wcvp.authority : "") : "") +
      ". This is country-level evidence and does not describe south-east Nigeria specifically.";
    result.sources.curated = {
      checked: true,
      note: "Not individually hand-verified. Resolved from the bundled WCVP v16 Nigeria distribution table (" + (native ? "native" : "introduced") + ")."
    };

    try {
      const classifyUrl = "https://api.gbif.org/v1/species/match?name=" + encodeURIComponent(result.matchedName) + "&kingdom=Plantae";
      const classifyMatch = await safeFetchJson(classifyUrl, 7000);
      if (classifyMatch.ok && classifyMatch.data && classifyMatch.data.usageKey) {
        const g = classifyMatch.data;
        gbifUsageKey = g.usageKey;
        result.classification = {
          kingdom: g.kingdom || null, phylum: g.phylum || null, class: g.class || null,
          order: g.order || null, family: g.family || result.family, genus: g.genus || null,
          species: g.species || result.matchedName
        };
      }
    } catch (e) { /* classification is a nice-to-have; the WCVP status is already available */ }
  } else {
    if (regional) {
      const hasNamedSources = regional.sources && !/^S\d+(?:,\s*S\d+)*$/.test(regional.sources);
      const sourceNote = hasNamedSources
        ? "Sources: " + regional.sources + "."
        : "Hand-verified against POWO; WCVP plant name ID: " + regional.wcvp_plant_name_id + ".";
      result.sources.curated = {
        checked: true,
        note: "Matched against the curated West African species table. " + sourceNote + " Nigeria status is not recorded. Regional review remains necessary."
      };
    }
    // ---- 2. GBIF fallback (official API) ----
    const cleanName = rawName.replace(/\(.*?\)/g, "").replace(/\bcf\.?\b/gi, "").trim();
    const gbifMatchUrl = "https://api.gbif.org/v1/species/match?name=" + encodeURIComponent(cleanName) + "&kingdom=Plantae";
    const gbifMatch = await safeFetchJson(gbifMatchUrl, 7000);

    if (!gbifMatch.ok) {
      result.sources.gbif = { checked: false, note: "GBIF lookup failed: " + gbifMatch.reason };
    } else {
      const gbif = gbifMatch.data;
      if (gbif && (gbif.matchType === "EXACT" || gbif.matchType === "FUZZY") && gbif.usageKey) {
        gbifUsageKey = gbif.usageKey;
        result.matchedName = gbif.canonicalName || gbif.scientificName;
        result.family = gbif.family || null;
        // Same GBIF match response already carries the full classification
        // ladder \u2014 no extra request needed. GBIF's backbone doesn't track
        // "Subclass" (Kew POWO does), so that rank is left out rather than
        // guessed at.
        result.classification = {
          kingdom: gbif.kingdom || null,
          phylum: gbif.phylum || null,
          class: gbif.class || null,
          order: gbif.order || null,
          family: gbif.family || null,
          genus: gbif.genus || null,
          species: gbif.species || result.matchedName || null
        };

        const distUrl = "https://api.gbif.org/v1/species/" + gbif.usageKey + "/distributions?limit=100";
        const distResult = await safeFetchJson(distUrl, 7000);

        if (!distResult.ok) {
          result.sources.gbif = { checked: true, note: "Matched to " + result.matchedName + ", but distribution lookup failed: " + distResult.reason };
        } else {
          const dists = (distResult.data && distResult.data.results) || [];
          const nigeriaDist = dists.find(d => (d.country === "NG" || (d.locality || "").toLowerCase().includes("nigeria")));
          const anyNative = dists.find(d => (d.establishmentMeans || "").toUpperCase() === "NATIVE");

          if (dists.length === 0) {
            result.sources.gbif = { checked: true, note: "Matched to " + result.matchedName + " but GBIF has no distribution/establishmentMeans records for it \u2014 regional status needs review." };
          } else if (nigeriaDist) {
            const means = (nigeriaDist.establishmentMeans || "UNCERTAIN").toUpperCase();
            if (means === "NATIVE") {
              statusSource = "gbif";
              result.status = "native"; result.statusLabel = "Native \u00b7 Indigenous (GBIF, automated)";
              result.note = "GBIF lists a NATIVE distribution record for Nigeria specifically.";
            } else if (["INTRODUCED", "NATURALIZED", "ADVENTIVE", "INVASIVE"].includes(means)) {
              statusSource = "gbif";
              result.status = "non-native"; result.statusLabel = "Non-native \u00b7 " + means.charAt(0) + means.slice(1).toLowerCase() + " (GBIF, automated)";
              result.note = "GBIF lists a Nigeria distribution record with establishmentMeans = " + means + ".";
            } else {
              result.note = "GBIF has a Nigeria distribution record, but establishmentMeans = " + means + " does not establish native or introduced status.";
            }
            result.origin = anyNative ? (anyNative.locality || anyNative.country || "See GBIF record") : "Not clearly stated";
            result.sources.gbif = { checked: true, note: "GBIF distribution record found for Nigeria (establishmentMeans: " + means + ")." };
          } else if (anyNative) {
              result.origin = anyNative.locality || anyNative.country || "See GBIF record";
              // GBIF native records with a country code outside Africa, plus
              // introduced records inside Africa and none native in Africa,
              // is strong enough to flag "likely non-native" (still reviewed).
              const nativeRecs = dists.filter(d => (d.establishmentMeans || "").toUpperCase() === "NATIVE");
              const nativeInAfrica = nativeRecs.some(d => AFRICAN_ISO2.has((d.country || "").toUpperCase()));
              const nativeOutside = nativeRecs.filter(d => d.country && !AFRICAN_ISO2.has(d.country.toUpperCase()));
              const introducedInAfrica = dists.filter(d => ["INTRODUCED", "NATURALIZED", "INVASIVE"].includes((d.establishmentMeans || "").toUpperCase()) && AFRICAN_ISO2.has((d.country || "").toUpperCase()));
              if (!nativeInAfrica && nativeOutside.length && introducedInAfrica.length) {
                statusSource = "gbif";
                const nativeCountries = [...new Set(nativeOutside.map(d => d.country))].join(", ");
                const introCountries = [...new Set(introducedInAfrica.map(d => d.country))].join(", ");
                result.statusLabel = "Likely non-native (needs confirmation)";
                result.origin = "Native range outside Africa (GBIF: " + nativeCountries + ")";
                result.note = "No Nigeria record was found. GBIF lists native records only outside Africa (" + nativeCountries + ") and introduced records in Africa (" + introCountries + "), so this is probably introduced in Nigeria. This is an inference, not a Nigeria record \u2014 confirm against POWO/FWTA before relying on it.";
                result.sources.gbif = { checked: true, note: "No Nigeria record; native only outside Africa and introduced elsewhere in Africa. Treated as 'likely non-native', kept in review." };
              } else {
                result.note = "GBIF lists native distribution elsewhere (" + result.origin + ") but does not provide enough Nigeria-specific evidence to classify this as native or introduced.";
                result.sources.gbif = { checked: true, note: "Native range found elsewhere, but absence of a Nigeria record is not treated as proof of introduction." };
              }
          } else {
            result.sources.gbif = { checked: true, note: "Matched to " + result.matchedName + " but distribution records didn't clearly resolve native vs. introduced \u2014 regional status needs review." };
          }
        }
      } else {
        result.sources.gbif = { checked: true, note: "No confident GBIF match for \"" + cleanName + "\"" };
      }
    }
  }

  // ---- 4. Regional names and common names (best-effort, never blocks) ----
  const nameForLookup = result.matchedName || rawName;
  const [wd, gbifNames, inat] = await Promise.all([
    lookupLocalNames(nameForLookup).catch(e => ({ checked: false, names: [], namesByLanguage: {}, commonName: null, note: "Wikidata lookup errored: " + e.message })),
    lookupGbifVernacularNames(gbifUsageKey).catch(e => ({ checked: false, names: [], namesByLanguage: {}, note: "GBIF vernacular lookup errored: " + e.message })),
    lookupINaturalist(nameForLookup).catch(e => ({ checked: false, commonName: null, note: "iNaturalist lookup errored: " + e.message }))
  ]);
  result.localNamesByLanguage = { ig: [], yo: [], ha: [] };
  [wd.namesByLanguage || {}, gbifNames.namesByLanguage || {}].forEach(source => {
    Object.keys(result.localNamesByLanguage).forEach(lang => {
      result.localNamesByLanguage[lang] = [...new Set(result.localNamesByLanguage[lang].concat(source[lang] || []))];
    });
  });
  result.localNames = Object.keys(result.localNamesByLanguage).flatMap(lang => result.localNamesByLanguage[lang].map(name => `${name} (${lang})`));
  result.commonName = wd.commonName || inat.commonName || null;
  result.sources.wikidata = { checked: wd.checked, note: wd.note };
  result.sources.gbifNames = { checked: gbifNames.checked, note: gbifNames.note };
  result.sources.inaturalist = { checked: inat.checked, note: inat.note };

  const griis = await griisPromise;
  result.sources.griis = { checked: griis.checked, note: griis.note };
  if (griis.found) {
    const means = griis.establishmentMeans;
    const meansLabel = means
      ? means.charAt(0) + means.slice(1).toLowerCase()
      : "introduced or invasive";
    const nativeConflict = result.status === "native";
    if (statusSource !== "curated" && statusSource !== "wcvp") {
      result.status = "non-native";
      result.statusLabel = "Non-native \u00b7 " + meansLabel + " (GRIIS Nigeria)";
      result.origin = "GRIIS Nigeria checklist";
      result.note = "The GRIIS Nigeria checklist includes this species as an introduced or invasive alien taxon." +
        (means ? " Its GBIF checklist distribution record specifies " + means + " in Nigeria." : " The specific invasion status is not stated in the checklist record.");
      if (nativeConflict) {
        result.note += " This conflicts with the GBIF distribution record and needs regional review.";
      }
    } else if (nativeConflict) {
      result.note += " GRIIS Nigeria also lists this species as introduced or invasive; the conflicting sources need regional review.";
    }
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
};
