# Phenology Logger — Ecosynthra Field (Netlify build, free tier)

Full rebuild: species compendium + phenology/growth logging + Excel/JSON/CSV
export + charts, in one static site. No longer specific to Mimosa — any
species logged gets checked against GBIF + Kew POWO and added to the
compendium automatically.

## What changed in this rebuild

1. **Header/footer**: "Ecosynthra Field" branding moved out of the header
   entirely — nav bar now just says "Phenology Logger". Attribution
   ("Ecosynthra Lab") lives in the footer with an auto-updating copyright
   year (`new Date().getFullYear()`, recomputed on every load — advances
   itself every Jan 1, nothing to maintain).

2. **Name check**: searched USPTO-indexed trademark records (via Justia)
   for "Phenology Logger" — no exact match found. Closest hits were
   "PHENOM" and "PHENOIMAGER", neither confusingly similar. "Phenology
   Logger" is also a fairly generic/descriptive name, which cuts both ways:
   low infringement risk, but weak if you ever wanted to trademark it
   yourself. This was an informal search, not a full USPTO clearance — if
   you ever plan to distribute this publicly under that name, a proper
   search (or a $99 tool like Trademarkia/Secure Mark USA) is worth the
   half hour.

3. **Removed the "no longer Mimosa-only" restrictions**: species dropdown
   is now generated alphabetically from the full compendium + a "New
   species" fallback — no genus gets special placement. The AI photo-ID
   prompt now references whichever species is selected in the form
   instead of assuming Mimosa.

4. **Quadrat Growth section removed** as a standalone tab. "Growth stage"
   (dropdown: Seedling / Juvenile / Mature-reproductive / Senescent) and
   "Height (cm)" (optional number field) now live directly inside the
   phenology entry form, so growth and phenophase are recorded together
   per visit instead of as separate record types.
   **Breaking change**: if you'd already logged quadrat records under the
   old `quadrat:` storage prefix, they won't appear in the new unified
   table — that data model no longer exists. Export your old data first
   (Export JSON) if you need to keep it.

5. **Photo removal**: once a photo is attached, an ✕ button appears over
   the preview to remove it before saving.

6. **Automated species classification** (`netlify/functions/classify-species.js`):
   when you save an observation for a species not already in the
   compendium, the app calls this function, which queries:
   - **GBIF** `species/match` — resolves the accepted name + family
   - **Kew POWO** `search` + `taxon` — pulls the native distribution text
   and applies a simple heuristic: if Nigeria or a broader region that
   covers it (West Tropical Africa, Tropical Africa, etc.) appears in the
   *native* range → tagged Native; if the native range is elsewhere but a
   POWO record exists → tagged Non-native; if nothing resolves → Unconfirmed.
   The new species is added to the compendium immediately, badged **"New"**,
   with the full POWO/GBIF response text kept as its source note so you can
   sanity-check the automated call. iNaturalist and FWTA are *not* queried
   automatically (no reliable free API for either) — those two always show
   as unchecked until you verify them yourself.
   No API key needed for this one — both GBIF and POWO's public endpoints
   are open.

7. **Observer field**: empty by default, no placeholder text.

8. **Supabase (optional, off by default)**: see below.

9. **Log & Export redesign**: one row per observation (long/tidy format) —
   see the in-app answer to "why not species-as-columns" below — plus a
   computed species-summary and a Chart.js line chart (Fournier scores over
   visit date) for whichever species you pick from a dropdown. Export
   button now produces a genuine `.xlsx` (via SheetJS) with three sheets:
   Observations, Species Summary, and Species Compendium — alongside the
   existing JSON and CSV buttons.

## Added after the initial rebuild

- **Photo upload fix**: the file input had `capture="environment"`, which
  forces mobile browsers straight into the camera. Removed — "Choose photo"
  now opens the normal native picker (Camera / Photo Library / Files).
- **Logo**: your uploaded PNG didn't actually have a transparent background
  (checked — it was flat RGB, no alpha channel). Regenerated with a real
  alpha channel, cropped tight, embedded as the header mark and favicon.
- **Plain-language tooltips**: small "i" buttons next to Fournier scale
  terms, growth stage options, and GPS accuracy — tap to expand a short
  explanation. Works on both touch and mouse (click-toggle, not hover-only).
- **Specimen life-cycle timeline** (Log & Export tab): the phenophase chart
  now has a Plot/Site filter alongside Species, so you can look at one
  monitoring point specifically rather than a species pooled across all
  sites. A photo storyboard strip sits above the chart — each visit's photo
  thumbnail (if attached) with a colored dot for that visit's dominant
  phenophase. Photos are now stored as a small (~140px) compressed
  thumbnail per record specifically for this view — full-resolution photos
  are still not persisted, to keep localStorage usage low.
- **Year-over-year flowering onset**: for any species+plot with two or more
  years of data, shows the first visit where the open-flower score reached
  2+ in the current year vs. the same in the previous year, and how many
  days earlier/later that was. Says plainly when there isn't enough data
  yet rather than guessing.

## Added: curated species lookup + Pl@ntNet photo-ID + Wikidata local names

**1. `classify-species.js` rewritten around a curated static table (option 3, the shippable version)**

The full WCVP dataset (1.4M+ names, hundreds of MB) isn't reachable from
where this was built and wouldn't fit in a serverless function anyway. What's
actually in place instead:

- A **hand-verified static table** of 16 West African ruderal/weed species
  (the original 11 + *Chromolaena odorata* — your actual focal invasive,
  which wasn't in the compendium until now — plus *Talinum triangulare*
  "waterleaf", *Ageratum conyzoides*, *Synedrella nodiflora*, *Sida acuta*),
  each checked against POWO/FWTA the same way as before. Zero network calls,
  can't break, instant. See the `CURATED_SPECIES` object at the top of the
  function to add more over time — that's the actual growth path for this
  design, not a bigger download.
- **GBIF's distributions endpoint** (documented at
  https://techdocs.gbif.org/en/openapi/) as the live fallback for anything
  not in the curated table — official, stable, replaces the POWO scrape
  entirely. Distribution coverage is patchier than POWO's per-species text,
  so more unfamiliar species will land as "unconfirmed" than before — that's
  the honest tradeoff for not depending on an undocumented endpoint.
- Note on *Talinum triangulare* ("waterleaf"): logged as **disputed** rather
  than picked a side. POWO's accepted name (*Talinum fruticosum*) lists
  native range as Tropical & Subtropical America; most West African
  agricultural/ethnobotanical sources describe it as native to Africa. Both
  are in the note so you can judge it yourself.

**2. Pl@ntNet photo identification** (`identify-species-plantnet.js`)

New "Identify species" button next to the photo picker. Sends the photo to
Pl@ntNet, shows up to 5 candidate species with confidence scores as tappable
cards — tapping one sets it as the species for the entry (still yours to
verify, not auto-trusted). Uses the `all` project (Pl@ntNet's worldwide
flora) since there's no West-Africa-specific regional project the way there
is for e.g. Western Europe.

Setup: in Netlify, Site settings → Environment variables → add
`PLANTNET_API_KEY`. Get a free key at https://my.plantnet.org/settings/api-key
if you don't already have one. Until this is set, the button will tell you
plainly that it's not configured rather than fail silently.

**3. Local-name enrichment via Wikidata (best-effort)**

Every classification now also queries Wikidata's SPARQL endpoint (official,
documented) for any Yoruba/Igbo/Hausa common names (property P1843) attached
to the matched taxon, shown in the species modal when found. Set your
expectations accordingly: I tested this against *Mimosa pudica* — one of the
most-documented plants in the world — and Wikidata had zero Yoruba/Igbo/Hausa
names for it, only Chinese for the family. Coverage for West African plants
is genuinely thin there. This is a bonus layer on top of the manually
researched names already in the curated table (e.g. Synedrella nodiflora's
Yoruba names, sourced from NMPPDB), not a replacement for them.

## Enabling Supabase sync

The app works fully offline on localStorage with no setup. To add
cross-device sync (now genuinely two-way — pushes on save, pulls on load,
stays live via realtime while the tab is open):

1. Create a free project at https://supabase.com (already done if you're
   reading this after setup).
2. In the SQL editor, run:

```sql
create table observations (
  id text primary key,
  "visitDate" text, species text, "plotId" text, observer text,
  "growthStage" text, height numeric,
  vegetative text, "flowerBud" text, "openFlower" text, "fruitPod" text, senescent text,
  cooccurring text, "weatherSoil" text, notes text,
  location jsonb, "hasPhoto" boolean, thumb text, "savedAt" text
);

create table species (
  id text primary key,
  common text, sci text, family text, status text, "statusLabel" text,
  origin text, note text, tags jsonb, img text, phenophase text,
  "phenoNote" text, "localNames" jsonb, sources jsonb, "userLogged" boolean
);

alter table observations enable row level security;
alter table species enable row level security;

-- both insert AND select policies are required — an insert-only policy
-- (what an earlier version of this README had) blocks the app from ever
-- reading data back, which silently breaks cross-device sync entirely.
create policy "public insert" on observations for insert with check (true);
create policy "public select" on observations for select using (true);
create policy "public insert" on species for insert with check (true);
create policy "public select" on species for select using (true);
create policy "public update" on species for update using (true);

-- required for the realtime subscription (live updates without a
-- manual refresh) to actually fire on other open devices/tabs:
alter publication supabase_realtime add table observations, species;
```

3. In Supabase: **Settings → API** — copy two values:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **Project API keys → `anon` `public`** key (a long JWT-looking string,
     NOT the `service_role` key — that one must never go in client-side code)

4. In `index.html`, near the top of the `<script>` block, set:
```js
const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...your-anon-public-key...";
```
5. Redeploy (re-drag the `netlify-site` folder onto Netlify Drop, or push
   if you've since connected a git repo).

Once live, the footer shows **"Cloud sync: live"** instead of "Local only"
— that's the quick way to confirm it actually took. On load, the app pulls
down anything saved from other devices (deduping observations by id and
species by scientific name) and merges it into local storage; while a tab
stays open, new saves from other devices arrive automatically via a
realtime subscription. A save from a device that's offline still succeeds
locally and syncs up next time it's back online — nothing is lost.

The `anon` key is meant to be public-facing (that's what row-level security
policies are for), but if this repo is ever pushed to a **public** GitHub
repo, it's still worth knowing both the Supabase URL and anon key would be
visible in the source — normal for this architecture, just worth being
aware of.

---

# Original Mimosa Field Phenology Logger — Netlify build (free tier)

(Original setup notes below still apply for the Gemini AI photo-ID feature.)

## Setup

1. Get a free Gemini API key at https://aistudio.google.com → "Get API key"
   (Google account required, no credit card).
2. In Netlify dashboard: Site settings → Environment variables →
   add `GEMINI_API_KEY` = your key.
3. Drag-and-drop the `netlify-site` folder onto https://app.netlify.com/drop,
   or connect it via git. Netlify auto-detects the function in
   `netlify/functions/`.
4. No environment variable is needed for `classify-species.js` — it uses
   GBIF/POWO's open endpoints directly.
