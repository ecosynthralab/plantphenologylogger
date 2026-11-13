# Plant Phenology Logger

**What it is:** a field-ready app for recording how plants change through
the seasons — when they leaf out, bud, flower, fruit, and go dormant —
built for botanical fieldwork in Nigeria and West Africa more broadly.

Open it on a phone in the field, log what you see, and it keeps working
whether or not you have signal.

---

## Why it exists

Phenology — the study of the timing of life-cycle events in plants and
animals — depends on repeat visits to the same individuals over weeks,
months, and years. That only works if the data capture is fast enough to
survive being done standing in a field with muddy boots, and consistent
enough that a visit in March and a visit in September are actually
comparable.

Plant Phenology Logger is built around that constraint. It's a single web page —
no app store, no install step required to start using it — that turns a
phone camera and a few taps into a structured, exportable observation
record.

## What it does

**Species identification from a photo.** Point the camera at a plant and
the app suggests a match, checking a photo-ID service first and falling
back to a second one if the first is unavailable, so a flaky connection
doesn't stop you mid-visit.

**Native vs. non-native classification.** Every species gets checked
against the regional species database (the curated West African table),
with Nigeria-specific records taking precedence over automated global
biodiversity lookups. After those, a bundled copy of Kew's WCVP v16 Nigeria
distribution (country-level native/introduced, including synonyms) resolves
many remaining species; doubtful or extinct records are left for review. A species recorded as native elsewhere in West Africa,
or not recorded for Nigeria, is not automatically classified as native or
introduced in Nigeria. When the evidence does not resolve its status, the
app says so — "Unconfirmed" — rather than guessing, because a wrong
classification is worse than an honest gap.

The separate World Plants Nigeria checklist is used as a comparison source,
not to infer native status from a blank introduced marker. Its overlap and
status conflicts with the curated table are summarized in the species
database workbook's "Checklist review" sheet. Source credit: Hassler, Michael
(1994–2026), *World Plants: Synonymic Checklist and Distribution of the World
Flora*, Version 26.10, last updated 29 October 2026; Nigeria distribution
checklist accessed 31 October 2026
(https://www.worldplants.de/complete-plant-list?tx_jaxonapi_listworld%5BdistCode%5D=NGA).
The workbook contains review statistics, not a copy of the checklist. This
attribution does not grant permission to redistribute source data; consult
the World Plants Data Policy and obtain any required permission before
redistributing or publishing checklist-derived material.

**Structured phenophase scoring.** Rather than free-text notes, each visit
records a 0–4 score across five stages — vegetative, flower bud, open
flower, fruit/pod, senescent — the format that actually supports plotting
change over time, not just describing a single visit.

**A life-cycle timeline per species.** Explore a seasonal profile of
monthly mean phenophase scores, or switch to visit history to see each
recorded observation in date order. The seasonal profile leaves months
without observations blank rather than estimating them. A year-over-year
comparison ("first flowering was 9 days earlier than last year") appears
once there's more than one season of data.

**Works offline, syncs when it can.** Every observation is saved to the
device immediately — no signal required in the field. If cloud sync is
configured for a team, saves quietly push up and pull down in the
background, so a colleague's Tuesday visit shows up on your phone by
Wednesday without anyone doing anything.

**Export for analysis.** Pull the full observation log out as JSON, CSV,
or an Excel workbook (with a species summary sheet included), ready for
whatever comes after fieldwork — a stats package, a report, a supervisor's
inbox.

**Backfill historical weather.** In Log & export, export a JSON backup, then
choose Backfill historical weather while online. The app updates observations
on the current device that have a valid past visit date and coordinates but
no recorded weather; existing weather and manual weather/soil notes are
preserved. Open-Meteo supplies estimates for 12:00 local time, not on-site
measurements, and recent dates may not yet be available. The result reports
skipped and failed records. Retry unavailable lookups later; if cloud sync
fails, use Push local data to cloud. Export a new CSV or Excel file to include
the updated weather. Both formats include the weather source, observation
time, and whether it is historical, where available.

For cloud sync, the Supabase `public.observations` table must have a `weather`
JSONB column. If sync reports that the column is missing, export a JSON backup
on the device with the updated records, then run this in the Supabase SQL Editor:

```sql
alter table public.observations
  add column if not exists weather jsonb;
```

Once the schema change is applied, choose **Push local data to cloud** on that
same device. Verify that the push succeeds before clearing browser data or
changing devices. Do not rerun backfill to retry a cloud sync: already saved
weather is deliberately skipped.

**Local names, where they exist.** Alongside the scientific classification,
the app checks for recorded Yoruba, Igbo, and Hausa common names for each
species — useful context for community-facing fieldwork, though coverage
in the underlying open databases is still genuinely thin for many West
African plants.

## Who it's for

Field botanists, ecology students, and conservation teams doing repeat-visit
phenology monitoring — anyone who needs the data collection to be as fast
and reliable as the biology it's tracking, on hardware that's just a phone.

## Funding acknowledgment

This project is sponsored by the Tertiary Education Trust Fund (TETFund)
through the Institution-Based Research (IBR) 2026 program.

**Reference number:** TETF/ES/DR&D/CE/UNI/AWKA/IBR/2026/VOL.1/42

## Under the hood, briefly

A single-page app with photo ID (Gemini, with Mistral as fallback, plus
Pl@ntNet), species classification (a curated table, WCVP, the Nigeria GRIIS
checklist, GBIF, and Wikidata), charts (Chart.js), spreadsheet export
(SheetJS), and optional cross-device sync via Supabase. Hosted on Netlify.
See `README.md` for the technical setup and deployment details.

The Nigeria GRIIS checklist is queried through the public GBIF API and shown
as a separate source in each species record. GRIIS confirms checklist
inclusion as an introduced or invasive alien taxon; it does not assess
agricultural damage, and a missing record is not evidence that a species is
native. Cite and check the dataset's terms when reusing its records.

Classification also checks GBIF vernacular names and the iNaturalist taxon
database. Regional names are stored separately for Igbo (`ig`), Yoruba
(`yo`), and Hausa (`ha`) when the sources provide them, and are included in
the Excel compendium export. If Supabase sync is enabled, add this column to
the `species` table so the structured names sync between devices:

```sql
alter table public.species
	add column if not exists "localNamesByLanguage" jsonb not null default '{}'::jsonb;
```

## Cross-device photos

When Supabase sync is enabled, photo thumbnails and compendium covers are
stored locally in IndexedDB and uploaded to a private Supabase Storage bucket
through `netlify/functions/sync-photo.js`. The synced observation/species row
contains the shared photo ID, so another device can request the same photo via
a short-lived signed URL. Configure `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `SYNC_SECRET` in Netlify; the private
`phenology-photos` bucket is created automatically on first photo upload.
Each device must enter the same sync passcode. Without Supabase configured,
photos remain local to that device by design.
