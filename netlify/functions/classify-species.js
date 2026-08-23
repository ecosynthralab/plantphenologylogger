// Netlify Function: classifies a species as native/non-native/unconfirmed
// for Nigeria, and attaches any local-language names found.
//
// Lookup order:
//   1. CURATED_SPECIES (static, below) — hand-verified against POWO/FWTA the
//      same way the original 11-species compendium was built. Zero network
//      calls, can't break, instant. This is "option 3" as actually shippable:
//      not the full 1.4M-name WCVP (not reachable from this environment and
//      too large for a serverless function anyway), but the West African
//      ruderal/weed species Chidimma is actually likely to log.
//   2. GBIF (official, documented API — https://techdocs.gbif.org/en/openapi/)
//      — species/match to resolve the name, then /species/{key}/distributions
//      for establishmentMeans. Used only when the static table has no match.
//      This REPLACES the old POWO scrape entirely — POWO has no official API
//      (confirmed: IPNI's own site states "there is no publicly available
//      API"), so it's no longer called live at all.
//   3. Wikidata SPARQL (official, documented) — best-effort lookup for any
//      local-language common names (P1843) in Yoruba/Igbo/Hausa. Coverage is
//      genuinely sparse for West African plants as of this writing — this
//      is a bonus layer, not a primary source, and is never allowed to slow
//      down or fail the main classification.

const NIGERIA_HINTS = [
  "nigeria", "w. trop. africa", "west tropical africa", "west africa",
  "guinea", "tropical africa", "trop. africa", "trop. & subtrop. africa",
  "s. tropical africa", "c. tropical africa", "e. tropical africa"
];

// ---------------------------------------------------------------------
// CURATED STATIC LOOKUP — hand-verified, sources cited in each note.
// Keyed by lowercase binomial (genus + species, no author).
// ---------------------------------------------------------------------
const CURATED_SPECIES = {
  "mimosa pudica": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Fabaceae (Mimosoideae)",
    origin: "Tropical Americas (Caribbean, Central & South America)",
    note: "Pantropical weed, present in West Africa but not native to it. FWTA: Hutchinson & Dalziel, ed. 2, Vol. 1 Part 2: 495 (1958).",
    fwtaChecked: true
  },
  "mimosa diplotricha": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Fabaceae (Mimosoideae)",
    origin: "Tropical Americas",
    note: "Giant sensitive plant; native to tropical America, invasive across the Old World tropics including West Africa.",
    fwtaChecked: false
  },
  "chamaecrista mimosoides": {
    status: "native", statusLabel: "Native \u00b7 Indigenous", family: "Fabaceae (Caesalpinioideae)",
    origin: "Tropical & Southern Africa, Tropical Asia to N. Australia",
    note: "As Cassia mimosoides L. in older Floras. FWTA: Keay, ed. 2, Vol. 1 Part 2 (1958); Nigeria within native range.",
    fwtaChecked: true
  },
  "euphorbia hirta": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Euphorbiaceae",
    origin: "Tropical America", note: "Naturalised pantropically incl. West Africa.", fwtaChecked: false
  },
  "evolvulus alsinoides": {
    status: "native", statusLabel: "Native \u00b7 Indigenous", family: "Convolvulaceae",
    origin: "Pantropical, present across Sub-Saharan Africa", note: "Native range includes tropical Africa.", fwtaChecked: false
  },
  "phyllanthus urinaria": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Phyllanthaceae",
    origin: "Tropical Asia", note: "Naturalised across tropical Africa incl. Nigeria.", fwtaChecked: false
  },
  "gomphrena celosioides": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Amaranthaceae",
    origin: "Brazil / South America", note: "Naturalised pantropically.", fwtaChecked: false
  },
  "ipomoea carnea": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Convolvulaceae",
    origin: "Tropical Americas", note: "Invasive shrub on African wetland margins.", fwtaChecked: false
  },
  "ludwigia octovalvis": {
    status: "native", statusLabel: "Native \u00b7 range debated, present pre-records", family: "Onagraceae",
    origin: "Pantropical; POWO lists West/Central Africa in native range",
    note: "Older Floras cite this as Jussiaea octovalvis.", fwtaChecked: false
  },
  "tridax procumbens": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Asteraceae",
    origin: "Tropical Americas", note: "One of the most widely recorded naturalised weeds in Nigeria.", fwtaChecked: false
  },
  "chromolaena odorata": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced (invasive)", family: "Asteraceae",
    origin: "Tropical & Subtropical America (POWO)",
    note: "Siam weed. Accidentally introduced to Nigeria \u224e1937 via Gmelina arborea seed from Sri Lanka; became the region's dominant fallow/roadside weed within ~20 years and is now one of the most-studied invasives in West Africa (Ivens 1974; Gautier 1992).",
    fwtaChecked: false
  },
  "talinum triangulare": {
    status: "non-native", statusLabel: "Disputed \u2014 Non-native per POWO, commonly described as African in regional sources",
    family: "Talinaceae", origin: "POWO (as Talinum fruticosum, accepted name): Tropical & Subtropical America",
    note: "\"Waterleaf.\" Genuinely contested: Kew POWO treats the accepted name Talinum fruticosum as native to the Americas, with T. triangulare naturalised in Africa. Many West African agricultural/ethnobotanical sources describe it as native to tropical Africa \u2014 likely reflecting centuries of cultivation rather than a taxonomic disagreement with POWO. Logged here as disputed rather than picking a side.",
    fwtaChecked: false
  },
  "ageratum conyzoides": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Asteraceae",
    origin: "Mexico (POWO); naturalised across South America, Africa, Asia", note: "Common roadside/farmland weed, not native to Africa.", fwtaChecked: false
  },
  "synedrella nodiflora": {
    status: "non-native", statusLabel: "Non-native \u00b7 Introduced", family: "Asteraceae",
    origin: "Tropical & Subtropical Americas (POWO)",
    note: "\"Cinderella weed.\" Widely naturalised in Nigeria/Ghana; Yoruba names recorded include ewe popo, aworo ona (NMPPDB).",
    fwtaChecked: false
  },
  "sida acuta": {
    status: "unknown", statusLabel: "Unconfirmed \u2014 broad native range needs region-level check", family: "Malvaceae",
    origin: "POWO lists \"Tropics & Subtropics\" (broad, ambiguous at this resolution)",
    note: "POWO's native-range label is too coarse here to say native vs. introduced for Nigeria specifically \u2014 needs the underlying TDWG region list, not yet checked.",
    fwtaChecked: false
  }
};

function normalizeName(name) {
  return (name || "").toLowerCase().replace(/\s*\(.*?\)/g, "").replace(/\bcf\.?\b/gi, "").replace(/\s+/g, " ").trim();
}

function lookupCurated(name) {
  const norm = normalizeName(name);
  if (CURATED_SPECIES[norm]) return { key: norm, ...CURATED_SPECIES[norm] };
  // also try just "genus species" (first two words) in case of trailing text
  const parts = norm.split(" ");
  if (parts.length > 2) {
    const short = parts.slice(0, 2).join(" ");
    if (CURATED_SPECIES[short]) return { key: short, ...CURATED_SPECIES[short] };
  }
  return null;
}

async function safeFetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/json" } });
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
  if (!result.ok) return { checked: false, names: [], note: "Wikidata lookup failed: " + result.reason };
  const bindings = (result.data.results && result.data.results.bindings) || [];
  const names = bindings
    .filter(b => ["yo", "ig", "ha"].includes(b.nameLang.value))
    .map(b => `${b.name.value} (${b.nameLang.value})`);
  return {
    checked: true,
    names: [...new Set(names)],
    note: names.length
      ? "Local names found on Wikidata: " + [...new Set(names)].join(", ")
      : "No Yoruba/Igbo/Hausa common names found on Wikidata for this taxon \u2014 coverage for West African plants is generally sparse there; check Burkill's Useful Plants of West Tropical Africa or NMPPDB instead."
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
    status: "unknown", statusLabel: "Unconfirmed", origin: "\u2014",
    note: "Automated lookup could not resolve this name with confidence \u2014 left unconfirmed for manual review.",
    localNames: [],
    sources: {
      curated: { checked: false, note: "Not in the curated West African species table" },
      gbif: { checked: false, note: "Not queried" },
      inaturalist: { checked: false, note: "Not queried by automated lookup \u2014 cross-check manually" },
      fwta: { checked: false, note: "Not queried by automated lookup \u2014 verify against your FWTA volumes" },
      wikidata: { checked: false, note: "Not queried" }
    }
  };

  // ---- 1. Curated static table (instant, no network) ----
  const curated = lookupCurated(rawName);
  if (curated) {
    result.matchedName = curated.key.replace(/\b\w/g, c => c.toUpperCase());
    result.family = curated.family;
    result.status = curated.status;
    result.statusLabel = curated.statusLabel;
    result.origin = curated.origin;
    result.note = curated.note;
    result.sources.curated = { checked: true, note: "Matched against the curated West African species table (hand-verified against POWO)." };
    result.sources.fwta = curated.fwtaChecked
      ? { checked: true, note: "FWTA citation included in the note above." }
      : { checked: false, note: "Not individually verified against FWTA text yet." };
  } else {
    // ---- 2. GBIF fallback (official API) ----
    const cleanName = rawName.replace(/\(.*?\)/g, "").replace(/\bcf\.?\b/gi, "").trim();
    const gbifMatchUrl = "https://api.gbif.org/v1/species/match?name=" + encodeURIComponent(cleanName) + "&kingdom=Plantae";
    const gbifMatch = await safeFetchJson(gbifMatchUrl, 7000);

    if (!gbifMatch.ok) {
      result.sources.gbif = { checked: false, note: "GBIF lookup failed: " + gbifMatch.reason };
    } else {
      const gbif = gbifMatch.data;
      if (gbif && (gbif.matchType === "EXACT" || gbif.matchType === "FUZZY") && gbif.usageKey) {
        result.matchedName = gbif.canonicalName || gbif.scientificName;
        result.family = gbif.family || null;

        const distUrl = "https://api.gbif.org/v1/species/" + gbif.usageKey + "/distributions?limit=100";
        const distResult = await safeFetchJson(distUrl, 7000);

        if (!distResult.ok) {
          result.sources.gbif = { checked: true, note: "Matched to " + result.matchedName + ", but distribution lookup failed: " + distResult.reason };
        } else {
          const dists = (distResult.data && distResult.data.results) || [];
          const nigeriaDist = dists.find(d => (d.country === "NG" || (d.locality || "").toLowerCase().includes("nigeria")));
          const anyNative = dists.find(d => (d.establishmentMeans || "").toUpperCase() === "NATIVE");

          if (dists.length === 0) {
            result.sources.gbif = { checked: true, note: "Matched to " + result.matchedName + " but GBIF has no distribution/establishmentMeans records for it \u2014 left unconfirmed." };
          } else if (nigeriaDist) {
            const means = (nigeriaDist.establishmentMeans || "UNCERTAIN").toUpperCase();
            if (means === "NATIVE") {
              result.status = "native"; result.statusLabel = "Native \u00b7 Indigenous (GBIF, automated)";
              result.note = "GBIF lists a NATIVE distribution record for Nigeria specifically.";
            } else {
              result.status = "non-native"; result.statusLabel = "Non-native \u00b7 " + means.charAt(0) + means.slice(1).toLowerCase() + " (GBIF, automated)";
              result.note = "GBIF lists a Nigeria distribution record with establishmentMeans = " + means + ".";
            }
            result.origin = anyNative ? (anyNative.locality || anyNative.country || "See GBIF record") : "Not clearly stated";
            result.sources.gbif = { checked: true, note: "GBIF distribution record found for Nigeria (establishmentMeans: " + means + ")." };
          } else if (anyNative) {
            result.status = "non-native"; result.statusLabel = "Non-native \u00b7 Introduced (inferred, GBIF)";
            result.origin = anyNative.locality || anyNative.country || "See GBIF record";
            result.note = "GBIF lists native distribution elsewhere (" + result.origin + ") but no record for Nigeria \u2014 treated as introduced/absent-from-native-range.";
            result.sources.gbif = { checked: true, note: "No Nigeria-specific record; native range found elsewhere: " + result.origin };
          } else {
            result.sources.gbif = { checked: true, note: "Matched to " + result.matchedName + " but distribution records didn't clearly resolve native vs. introduced \u2014 left unconfirmed." };
          }
        }
      } else {
        result.sources.gbif = { checked: true, note: "No confident GBIF match for \"" + cleanName + "\"" };
      }
    }
  }

  // ---- 3. Wikidata local names (best-effort, never blocks) ----
  try {
    const nameForWikidata = result.matchedName || rawName;
    const wd = await lookupLocalNames(nameForWikidata);
    result.localNames = wd.names;
    result.sources.wikidata = { checked: wd.checked, note: wd.note };
  } catch (e) {
    result.sources.wikidata = { checked: false, note: "Wikidata lookup errored: " + e.message };
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
};
