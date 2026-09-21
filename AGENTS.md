# Vesper

> Free, open-source (MIT) Bible-meditation PWA: guided audio meditations with synchronised text, a bilingual Bible reader, breathing exercises and ambient music — all static files, for anyone.

**Status:** live at `vesper.pm` · **Last verified:** 2026-09-21

This file is the entry point for any AI model or engineer taking over this project.
It is written to be publishable: no secrets, no internal topology, no personal data.
Anything marked `<LIKE_THIS>` is a deployment-specific value; it is not part of this
repository.

Read next, in this order: `README.md` (product, features, design tokens, brand),
`docs/creating-meditations.md` (content + TTS pipeline, JSON schema, alignment format),
`tools/AUDIO-PIPELINE.md` (ambient-music processing). This file does not repeat them.

## What it does
- Guided meditations (sleep, morning, anxiety, self-compassion, contemplative, SOS, prayer) with pre-generated narration in English (two voices) and French, highlighted line by line during playback.
- Bible reader in two public-domain translations (EN/FR) with daily lectionary readings, full-text search and in-browser text-to-speech.
- Breathing exercises, ambient music player, light/dark/auto theme, installable PWA with lock-screen controls.
- No server, no database, no accounts, no tracking: a static build plus a directory of audio files.

## Stack
Astro 5 (static output) · React 19 islands · TypeScript strict · Tailwind CSS v4 + CSS custom properties · Framer Motion · client-side ONNX TTS for Bible reading · a hosted TTS API (with character-level alignment) for meditation narration, used **only at authoring time** · `tsx` pipeline scripts · a few Python helpers and `ffmpeg` for audio repair/splicing · pnpm.

## Directory map
| Path | Role |
|---|---|
| `src/pages/` | Astro routes (`bible/`, `meditate/`, `sleep/`, `breathe/`, `music`, `settings`, ...) |
| `src/components/` | React islands (`MeditationPlayer`, `BibleReaderClient`, `BibleTTS`, ...) |
| `src/content/meditations/*.json` | **Single source of truth** for every meditation (bilingual script, breathing pattern, audio paths) |
| `src/content/bible/`, `breathing/`, `music.json` | Static data |
| `src/lib/` | `parseScript`, `i18n`, `lectionary`, `liturgical-context`, constants |
| `scripts/pipeline.ts` | CLI orchestrator: `status`, `create`, `import`, `generate-tts`, `deploy` |
| `scripts/prepare-tts.ts` | Script text → TTS text (strips directions, converts pauses, per-category voice settings) |
| `scripts/generate-tts.ts` | Calls the TTS API, writes `.mp3` + alignment `.json`, fixes MP3 headers |
| `scripts/insert-breathing.ts` | Splices clip-based breathing counts at the `[BREATHING_SECTION]` marker |
| `scripts/generate-breathing-clips.ts`, `segment-audio.ts`, `rebuild-alignment.ts`, `assemble-duration.ts` | Supporting audio steps |
| `scripts/qa-meditations.ts` | QA gate run before every deploy |
| `scripts/lib/` | `validate-meditation`, `breathing-audio`, `retry`, `lockfile` |
| `scripts/*.py` | One-off repair tools (MP3 headers, breathing reconstruction, forced alignment) |
| `scripts/build-search-index.ts`, `build-sitemap.ts` | Build-time generators |
| `tools/process-music.mjs`, `tools/audio-mixer.html` | Ambient-music therapeutic processing (CLI + browser) |
| `audio-storage/{en,en-v2,fr}/` | Generated narration, **gitignored** |
| `music/raw/`, `music/processed/` | Music working dirs, gitignored; shipped MP3s live in `public/music/` |
| `docs/creating-meditations.md` | Authoring guide |

## Run locally
```
pnpm install
pnpm dev            # Astro dev server
```
No secrets needed to run or build the app. Without `audio-storage/` the meditation pages render but have no narration. TTS generation cannot run without `ELEVENLABS_API_KEY`.

## Build
```
pnpm build
```
Here `pnpm build` is real: `prebuild` runs `build:search` (writes the gitignored `public/search-index.json`), then `astro build`, then `build:sitemap` (writes `dist/sitemap.xml`). `pnpm check` runs `astro check`. `ASTRO_BASE` must be unset or `/`.

## Deploy
```
npx tsx scripts/pipeline.ts deploy        # flags: --skip-qa --skip-build --skip-audio --skip-git
```
Steps, in order: (0) QA gate over every meditation and language, aborts on failure; (0b) refuses a non-root `ASTRO_BASE`; (1) `pnpm build`, then asserts the built HTML has no sub-path asset URLs; (2) `rsync --delete` of `dist/` to `<DEPLOY_ROOT>`, **excluding `audio/`**; (3) copies `audio-storage/{en,en-v2,fr}` into `<DEPLOY_ROOT>/audio/`; (4) `git add -A`, commit `chore: deploy update`, push.
- The deploy root is currently hard-coded in `scripts/pipeline.ts` (see Known gaps); publishing to it is a privileged step whose setup is deployment-specific; not part of this repository. There is no service to restart: the web server serves the directory.
- Verify: load the public site, play one meditation per language, confirm highlight sync.
- Roll back: check out the previous commit, rebuild, redeploy with `--skip-git`. Audio is not versioned; keep the `.tts-original.*` snapshots.
- Git convention: standalone public repo, trunk only, push to `main`.

## Configuration
| Variable | Purpose | Required by | If missing |
|---|---|---|---|
| `ELEVENLABS_API_KEY` | TTS API credential | `scripts/generate-tts.ts` | Generation fails; app and build unaffected |
| `ELEVENLABS_VOICE_EN`, `ELEVENLABS_VOICE_FR` | Override default narrator voices | `scripts/generate-tts.ts` | Built-in defaults |
| `ASTRO_BASE` | Astro base path | `astro.config.ts`, deploy check | Defaults to `/` (correct) |
| `ASTRO_SITE` | Canonical site URL | `astro.config.ts` | Built-in default |

See `.env.example`. `.env` is gitignored.

## Data and state
- In git: all content JSON, scripts, shipped music MP3s. Bible texts are public domain.
- Not in git, **irreplaceable without paying for regeneration**: `audio-storage/` (narration `.mp3`, alignment `.json`, `*.tts-original.*` snapshots, `segments/`). Back it up outside git.
- Derived: `dist/`, `public/search-index.json`, `scripts/prompts/`.
- Gitignored on purpose: maintainer workspace files (private tier — excluded from any public export; see `.gitignore`) — maintainer workspace files (private tier) must never reach this public repo.
- Browser: locale, theme, voice and music choice in `localStorage` only.

## Health checks
"Healthy" means the public domain answers over TLS and audio URLs under `/audio/<lang>/` answer 200 with an audio MIME type. `scripts/qa-meditations.ts` is the content-level check.

## Narration audio pipeline (order matters)
1. Author/edit `src/content/meditations/<slug>.json` (`scriptEn`, `scriptFr`, `breathing`).
2. `npx tsx scripts/generate-tts.ts --dry-run <slug>` — inspect the prepared text, free.
3. `npx tsx scripts/generate-tts.ts <slug> --lang=en|fr` (or `--missing`) — paid API call; writes audio + alignment and repairs the MP3 duration header.
4. `npx tsx scripts/insert-breathing.ts <slug> --lang=<lang>` (`--dry-run`, `--all`) — splices breathing counts. On first run it snapshots `<slug>.tts-original.mp3/.json`; later runs restore from the snapshot first.
5. `npx tsx scripts/qa-meditations.ts`, then deploy.

Bug history documented in the repo: re-running breathing insertion on already-processed audio after a script edit once stacked stale breathing sections (one French session ended up with many repeated "last one" cues). Fix = the snapshot/restore idempotency above, and never modifying the TTS source in place. A failed MP3 header repair only warns; mobile players may then show a wrong duration.

## Things a new model gets wrong
1. **Deploy commits everything.** Step 4 runs `git add -A` and pushes to a **public** repo. Any stray file not covered by `.gitignore` gets published. Check `git status` first or use `--skip-git`.
2. **Deleting `*.tts-original.*` as clutter.** They are the clean source that makes breathing insertion idempotent; without them a re-run bakes breathing in twice or forces a paid regeneration.
3. **Regenerating TTS to fix a typo.** Costs money and changes timing. Use `--dry-run`; for alignment-only problems use `scripts/rebuild-alignment.ts`.
4. **Setting `ASTRO_BASE` to a sub-path.** Every asset URL then breaks at the root domain. Deploy blocks it; manual builds do not.
5. **Editing text in the alignment JSON or player instead of the meditation JSON.** Display lines come from `parseScript()` and are matched sequentially to alignment lines; a change in the number of spoken lines without regenerating alignment desynchronises highlighting.
6. **Following the old doc path.** The authoring guide is `docs/creating-meditations.md`; a root-level `CREATING-MEDITATIONS.md` does not exist.
7. **Letting `rsync --delete` near the audio.** It is safe only because of `--exclude=audio/`. Keep that exclude in any hand-written deploy.
8. **Using `--skip-qa` routinely.** It exists for emergencies; the gate is what stops broken audio shipping.
9. **Committing `CLAUDE.md` or `.claude/`.** Gitignored deliberately.

## Known gaps
- No unit tests; QA script and `astro check` only. No CI.
- The deploy target path is hard-coded in `scripts/pipeline.ts`; it should come from configuration.
- `audio-storage/` has no in-repo backup story.
- Both `playwright` and `puppeteer` are devDependencies, used only by demo-recording scripts.

## How to update this file
Hand-written. The directory map and Configuration table are checked against `package.json`, `scripts/` and `grep process.env`. Correct facts here rather than in a side document.
