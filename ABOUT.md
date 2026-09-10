# Ecosynthra Field — Phenology Logger

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

Ecosynthra Field is built around that constraint. It's a single web page —
no app store, no install step required to start using it — that turns a
phone camera and a few taps into a structured, exportable observation
record.

## What it does

**Species identification from a photo.** Point the camera at a plant and
the app suggests a match, checking a photo-ID service first and falling
back to a second one if the first is unavailable, so a flaky connection
doesn't stop you mid-visit.

**Native vs. non-native classification.** Every species gets checked
against a hand-curated table of West African species (verified against
standard floras), with an automated fallback to global biodiversity
databases for anything not already catalogued. When neither source can
answer confidently, the app says so — "Unconfirmed" — rather than
guessing, because a wrong classification is worse than an honest gap.

**Structured phenophase scoring.** Rather than free-text notes, each visit
records a 0–4 score across five stages — vegetative, flower bud, open
flower, fruit/pod, senescent — the format that actually supports plotting
change over time, not just describing a single visit.

**A life-cycle timeline per species.** Log the same species across
multiple visits and the app charts how its phenophase scores move through
the year, with a year-over-year comparison ("first flowering was 9 days
earlier than last year") once there's more than one season of data.

**Works offline, syncs when it can.** Every observation is saved to the
device immediately — no signal required in the field. If cloud sync is
configured for a team, saves quietly push up and pull down in the
background, so a colleague's Tuesday visit shows up on your phone by
Wednesday without anyone doing anything.

**Export for analysis.** Pull the full observation log out as JSON, CSV,
or an Excel workbook (with a species summary sheet included), ready for
whatever comes after fieldwork — a stats package, a report, a supervisor's
inbox.

**Local names, where they exist.** Alongside the scientific classification,
the app checks for recorded Yoruba, Igbo, and Hausa common names for each
species — useful context for community-facing fieldwork, though coverage
in the underlying open databases is still genuinely thin for many West
African plants.

## Who it's for

Field botanists, ecology students, and conservation teams doing repeat-visit
phenology monitoring — anyone who needs the data collection to be as fast
and reliable as the biology it's tracking, on hardware that's just a phone.

## Under the hood, briefly

A single-page app with photo ID (Gemini, with Mistral as fallback, plus
Pl@ntNet), species classification (a curated table backed by GBIF and
Wikidata), charts (Chart.js), spreadsheet export (SheetJS), and optional
cross-device sync via Supabase. Hosted on Netlify. See `README.md` for the
technical setup and deployment details.
