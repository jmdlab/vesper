/**
 * Vesper meditation pipeline — single-command automation for creating,
 * generating TTS, and deploying meditation content.
 *
 * Usage:
 *   npx tsx scripts/pipeline.ts create --category=sleep --count=2
 *   npx tsx scripts/pipeline.ts generate-tts --slug=sleep-new-meditation --lang=en
 *   npx tsx scripts/pipeline.ts generate-tts --missing
 *   npx tsx scripts/pipeline.ts deploy
 *   npx tsx scripts/pipeline.ts status
 *   npx tsx scripts/pipeline.ts import [slug]
 *   npx tsx scripts/pipeline.ts post-process <slug> --lang=en
 *   npx tsx scripts/pipeline.ts segment --all --lang=en
 *   npx tsx scripts/pipeline.ts assemble <slug> --duration=10 --lang=en
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { acquireLock } from './lib/lockfile.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const CONTENT_DIR = join(PROJECT_ROOT, 'src', 'content', 'meditations')
const REWRITES_DIR = join(PROJECT_ROOT, 'scripts', 'rewrites')
const AUDIO_DIR = join(PROJECT_ROOT, 'audio-storage')
const DIST_DIR = join(PROJECT_ROOT, 'dist')

// ─── Types ──────────────────────────────────────────────────────────────────

interface MeditationJSON {
  slug: string
  titleEn: string
  titleFr: string
  descEn: string
  descFr: string
  scriptEn: string
  scriptFr: string
  category: string
  durationMin: number
  isSleep: boolean
  verseRefs: unknown
  audioPathEn: string | null
  audioPathFr: string | null
  sortOrder: number
  scienceUrl?: string | null
  breathing: {
    slug: string
    nameEn: string
    nameFr: string
    inhale: number
    holdIn: number
    exhale: number
    holdOut: number
    rounds: number
  } | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadAllMeditations(): MeditationJSON[] {
  const files = readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'))
  return files.map(f => JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf-8')))
}

function loadMeditation(slug: string): MeditationJSON | null {
  const path = join(CONTENT_DIR, `${slug}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function getNextSortOrder(category: string): number {
  const all = loadAllMeditations().filter(m => m.category === category)
  const maxSort = Math.max(0, ...all.map(m => m.sortOrder))
  return maxSort + 1
}

function getCategoryPrefix(category: string): string {
  if (category === 'sleep') return 'sleep'
  if (category === 'morning') return 'morning'
  if (category === 'sos') return 'sos'
  if (category === 'prayer') return 'prayer'
  return 'meditate'
}

function getBreathingDefault(category: string): MeditationJSON['breathing'] {
  if (category === 'sleep') {
    return { slug: 'deep-calm', nameEn: 'Deep Calm', nameFr: 'Calme profond', inhale: 5, holdIn: 0, exhale: 7, holdOut: 0, rounds: 6 }
  }
  if (category === 'morning') {
    return { slug: 'energizing', nameEn: 'Energizing', nameFr: 'Energisant', inhale: 4, holdIn: 4, exhale: 4, holdOut: 0, rounds: 4 }
  }
  return { slug: 'box-breathing', nameEn: 'Box Breathing', nameFr: 'Respiration carree', inhale: 4, holdIn: 4, exhale: 4, holdOut: 4, rounds: 4 }
}

function run(cmd: string, args: string[], options?: { cwd?: string }): void {
  execFileSync(cmd, args, {
    cwd: options?.cwd ?? PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env,
  })
}

function runCapture(cmd: string, args: string[], options?: { cwd?: string }): string {
  return execFileSync(cmd, args, {
    cwd: options?.cwd ?? PROJECT_ROOT,
    encoding: 'utf-8',
    env: process.env,
  }).trim()
}

// ─── CREATE command ─────────────────────────────────────────────────────────

const SCRIPT_TEMPLATE = `
You are creating a meditation script for the Vesper app. Follow these guidelines EXACTLY:

## Category: {{CATEGORY}}
## Slot: {{SLOT_NUMBER}} of {{COUNT}}

## Script Structure Rules

1. **Opening breathing instruction** — First line must be a stage direction in brackets:
   [BREATHING: Pattern name — description of the breathing pattern.]

2. **Natural spoken text** — Write as if narrating to one person lying in bed (sleep) or sitting quietly (other categories). Use second person ("you"). No bullet points, no headers, just flowing text.

3. **Pause markers** — Use [Xs pause] for silence:
   - Sleep: generous pauses (10s, 15s, 20s, 30s, even 60s)
   - Meditate: moderate pauses (10s, 15s, 20s)
   - Morning: tight pauses (5s, 10s max)

4. **Scripture** — Include 2-3 Bible verses, quoted with em dashes for attribution:
   "Be still, and know that I am God." — Psalm 46:10

5. **Stage directions** — Use [...] for narrator guidance (these are stripped from TTS):
   [Voice softens here]
   [Slow down]

6. **Paragraph breaks** — Use blank lines between sections. These become pauses in TTS.

7. **Duration targets**:
   - Sleep: 25-35 minutes of spoken content
   - Meditate: 15-25 minutes
   - Morning: 5-9 minutes

8. **Tone**:
   - Sleep: Intimate, low, approaching a whisper by the final third. Progressive deepening.
   - Meditate: Warm, grounded, unhurried. Contemplative.
   - Morning: Gentle energy, forward-looking, purposeful.

9. **Content approach** — Draw from the expert panel:
   - Theologian: Scripture context, not proof-texting
   - Sleep psychologist: Body scan, progressive relaxation, imagery
   - Meditation teacher: Breath awareness, noting practice, present-moment anchoring
   - Therapist (ACT/CFT): Cognitive defusion, self-compassion, acceptance
   - Contemplative prayer specialist: Centering prayer, lectio divina, Ignatian imagination
   - Mindfulness instructor: Non-judgmental awareness, sensory grounding

10. **End with descent into sleep** (sleep category) or **closing prayer/intention** (other categories).

## What NOT to do
- No numbered lists or bullet points in the script
- No meta-commentary ("In this meditation, we will...")
- No generic affirmations without grounding
- No rushing — let silence do the work
- No theological lecturing — weave scripture naturally

## Output Format
Return ONLY the script text, starting with [BREATHING: ...]. No preamble, no explanation.
`.trim()

function generateCreatePrompt(category: string, slotNumber: number, count: number): string {
  return SCRIPT_TEMPLATE
    .replace('{{CATEGORY}}', category)
    .replace('{{SLOT_NUMBER}}', String(slotNumber))
    .replace('{{COUNT}}', String(count))
}

function handleCreate(): void {
  const args = process.argv.slice(3)
  const category = args.find(a => a.startsWith('--category='))?.split('=')[1]
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '1')

  if (!category) {
    console.error('Missing --category flag. Options: sleep, morning, meditate, sos, prayer, anxiety, self-compassion, contemplative')
    process.exit(1)
  }

  console.log(`\n=== Create ${count} new ${category} meditation(s) ===\n`)
  console.log('This command creates skeleton JSON files with placeholder content.')
  console.log('You need to fill in the actual scripts (EN + FR) before generating TTS.')
  console.log('')

  const prefix = getCategoryPrefix(category)

  for (let i = 1; i <= count; i++) {
    const prompt = generateCreatePrompt(category, i, count)
    const placeholderSlug = `${prefix}-new-${Date.now()}-${i}`

    const skeleton: MeditationJSON = {
      slug: placeholderSlug,
      titleEn: '[TODO: English title]',
      titleFr: '[TODO: French title]',
      descEn: '[TODO: English description — 1-2 sentences about the neuroscience/therapeutic approach]',
      descFr: '[TODO: French description]',
      scriptEn: '[BREATHING: TODO — choose a breathing pattern]\n\n[TODO: Write the meditation script using the prompt below]\n\n[10s pause]\n\nThis is a placeholder. Replace with actual content.',
      scriptFr: '[BREATHING: TODO — choisir un pattern de respiration]\n\n[TODO: Ecrire le script de meditation]\n\n[10s pause]\n\nCeci est un placeholder. Remplacer par le contenu reel.',
      category,
      durationMin: category === 'sleep' ? 28 : category === 'morning' ? 7 : 20,
      isSleep: category === 'sleep',
      verseRefs: null,
      audioPathEn: null,
      audioPathFr: null,
      sortOrder: getNextSortOrder(category) + i - 1,
      scienceUrl: null,
      breathing: getBreathingDefault(category),
    }

    const jsonPath = join(CONTENT_DIR, `${placeholderSlug}.json`)
    writeFileSync(jsonPath, JSON.stringify(skeleton, null, 2) + '\n')

    // Write rewrite files
    const rewriteCategory = prefix === 'meditate' ? 'meditate' : prefix
    const rewriteDir = join(REWRITES_DIR, rewriteCategory)
    if (!existsSync(rewriteDir)) mkdirSync(rewriteDir, { recursive: true })
    writeFileSync(join(rewriteDir, `${placeholderSlug}.en.txt`), skeleton.scriptEn)
    writeFileSync(join(rewriteDir, `${placeholderSlug}.fr.txt`), skeleton.scriptFr)

    console.log(`  [${i}/${count}] Created skeleton: ${placeholderSlug}`)
    console.log(`    JSON: src/content/meditations/${placeholderSlug}.json`)
    console.log(`    Edit the JSON file to set title, description, and scripts.`)
    console.log(`    Then rename the file to match the final slug.`)
    console.log('')

    // Save prompt for AI script generation
    const promptDir = join(PROJECT_ROOT, 'scripts', 'prompts')
    if (!existsSync(promptDir)) mkdirSync(promptDir, { recursive: true })
    writeFileSync(join(promptDir, `${placeholderSlug}.txt`), prompt)
    console.log(`    Prompt saved to: scripts/prompts/${placeholderSlug}.txt`)
    console.log(`    (Copy this prompt to Claude/ChatGPT to generate the script content)`)
    console.log('')
  }

  console.log('=== Next Steps ===')
  console.log('1. Edit the JSON files in src/content/meditations/ — fill in title, desc, scripts')
  console.log('2. Rename files to their final slug (e.g., sleep-ocean-drift.json)')
  console.log('3. Run: npx tsx scripts/pipeline.ts generate-tts --missing')
  console.log('4. Run: npx tsx scripts/pipeline.ts deploy')
}

// ─── GENERATE-TTS command ───────────────────────────────────────────────────

function handleGenerateTTS(): void {
  const args = process.argv.slice(3)

  // Remap --slug=X to positional arg for generate-tts.ts
  const slugFlag = args.find(a => a.startsWith('--slug='))
  const passArgs = args
    .filter(a => !a.startsWith('--slug='))
    .concat(slugFlag ? [slugFlag.split('=')[1]] : [])

  console.log(`\nDelegating to generate-tts.ts...\n`)

  try {
    run('npx', ['tsx', 'scripts/generate-tts.ts', ...passArgs])
  } catch {
    process.exit(1)
  }
}

// ─── DEPLOY command ─────────────────────────────────────────────────────────

function handleDeploy(): void {
  const args = process.argv.slice(3)
  const skipBuild = args.includes('--skip-build')
  const skipAudio = args.includes('--skip-audio')
  const skipGit = args.includes('--skip-git')
  const skipQA = args.includes('--skip-qa')

  const DEPLOY_DIR = '/var/www/vesper-static'

  console.log('\n=== Vesper Deploy ===\n')

  // 0. QA gate — never ship broken audio. --skip-qa is for emergencies only.
  if (!skipQA) {
    console.log('0. Running QA (all meditations, all languages)...')
    try {
      run('npx', ['tsx', 'scripts/qa-meditations.ts'])
      console.log('   QA passed.\n')
    } catch {
      console.error('   QA FAILED — aborting deploy.')
      console.error('   Fix the failures reported above, or use --skip-qa to bypass (not recommended).')
      process.exit(1)
    }
  } else {
    console.log('0. QA skipped (--skip-qa)\n')
  }

  // 0. Validate env — base must be '/' for vesper.pm
  const astroBase = process.env.ASTRO_BASE || ''
  if (astroBase && astroBase !== '/') {
    console.error(`ASTRO_BASE is "${astroBase}" — must be "/" for vesper.pm.`)
    console.error('Check .env or unset ASTRO_BASE.')
    process.exit(1)
  }

  // 1. Build
  if (!skipBuild) {
    console.log('1. Building...')
    try {
      run('pnpm', ['build'])
    } catch {
      console.error('Build failed!')
      process.exit(1)
    }
    // Sanity check: verify built HTML doesn't reference /bible/_astro/
    const builtIndex = join(DIST_DIR, 'index.html')
    if (existsSync(builtIndex)) {
      const html = readFileSync(builtIndex, 'utf-8')
      if (html.includes('/bible/_astro/')) {
        console.error('Build produced /bible/_astro/ paths — ASTRO_BASE is wrong!')
        console.error('Set ASTRO_BASE=/ in .env and rebuild.')
        process.exit(1)
      }
    }
    console.log('   Build complete.\n')
  }

  // 2. Rsync dist to deploy target
  if (existsSync(DEPLOY_DIR)) {
    console.log(`2. Deploying dist/ to ${DEPLOY_DIR}/...`)
    try {
      run('sudo', ['rsync', '-a', '--delete',
        '--exclude=audio/', // preserve audio separately
        `${DIST_DIR}/`, `${DEPLOY_DIR}/`])
      console.log('   Deploy complete.\n')
    } catch (e) {
      console.error(`   Deploy failed: ${e}`)
      process.exit(1)
    }
  } else {
    console.error(`Deploy target ${DEPLOY_DIR} not found!`)
    process.exit(1)
  }

  // 3. Copy audio files
  if (!skipAudio) {
    console.log('3. Copying audio files...')
    const audioTarget = join(DEPLOY_DIR, 'audio')
    for (const langDir of ['en', 'en-v2', 'fr']) {
      const src = join(AUDIO_DIR, langDir)
      const dest = join(audioTarget, langDir)
      if (existsSync(src)) {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
        try {
          cpSync(src, dest, { recursive: true })
          const audioCount = readdirSync(src).filter(f => f.endsWith('.mp3')).length
          const segDir = join(src, 'segments')
          const segCount = existsSync(segDir) ? readdirSync(segDir).length : 0
          console.log(`   ${langDir}: ${audioCount} audio files${segCount ? `, ${segCount} segmented meditations` : ''} copied`)
        } catch (e) {
          console.error(`   Failed to copy ${langDir}: ${e}`)
        }
      }
    }
    console.log('')
  }

  // 4. Git push
  if (!skipGit) {
    console.log('4. Pushing to GitHub...')
    try {
      run('git', ['add', '-A'])
      const status = runCapture('git', ['status', '--porcelain'])
      if (status) {
        run('git', ['commit', '-m', 'chore: deploy update'])
        run('git', ['push'])
        console.log('   Pushed to GitHub.\n')
      } else {
        console.log('   Nothing to commit.\n')
      }
    } catch (e) {
      console.error(`   Git push failed: ${e}`)
    }
  }

  console.log('Deploy complete!')
}

// ─── STATUS command ─────────────────────────────────────────────────────────

function handleStatus(): void {
  console.log('\n=== Vesper Content Status ===\n')

  const meditations = loadAllMeditations()
    .filter(m => !m.slug.startsWith('breathe-'))
    .sort((a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder)

  const categories = new Map<string, MeditationJSON[]>()
  for (const m of meditations) {
    const list = categories.get(m.category) ?? []
    list.push(m)
    categories.set(m.category, list)
  }

  let totalMissing = 0

  for (const [category, items] of categories) {
    console.log(`${category.toUpperCase()} (${items.length})`)
    for (const m of items) {
      const hasEnAudio = existsSync(join(AUDIO_DIR, 'en', `${m.slug}.mp3`))
      const hasFrAudio = existsSync(join(AUDIO_DIR, 'fr', `${m.slug}.mp3`))
      const hasV2Audio = existsSync(join(AUDIO_DIR, 'en-v2', `${m.slug}.mp3`))
      const hasEnScript = m.scriptEn && m.scriptEn.trim().length > 100
      const hasFrScript = m.scriptFr && m.scriptFr.trim().length > 100

      const audioStatus = [
        hasEnAudio ? 'EN' : '--',
        hasFrAudio ? 'FR' : '--',
        hasV2Audio ? 'V2' : '--',
      ].join(' ')

      const scriptStatus = [
        hasEnScript ? 'EN' : '--',
        hasFrScript ? 'FR' : '--',
      ].join(' ')

      if (!hasEnAudio || !hasFrAudio) totalMissing++

      console.log(`  ${m.slug.padEnd(35)} script:[${scriptStatus}] audio:[${audioStatus}] ${m.durationMin}min`)
    }
    console.log('')
  }

  console.log(`Total: ${meditations.length} meditations, ${totalMissing} missing audio`)
}

// ─── IMPORT command ─────────────────────────────────────────────────────────

function handleImport(): void {
  const args = process.argv.slice(3)
  const slugArg = args.find(a => !a.startsWith('--'))

  console.log('\n=== Import Scripts from Rewrites ===\n')

  const meditations = slugArg
    ? [loadMeditation(slugArg)].filter((m): m is MeditationJSON => m !== null)
    : loadAllMeditations().filter(m => !m.slug.startsWith('breathe-'))

  let updated = 0

  for (const m of meditations) {
    const prefix = getCategoryPrefix(m.category)
    const categoryDir = prefix === 'meditate' ? 'meditate' : prefix
    const enPath = join(REWRITES_DIR, categoryDir, `${m.slug}.en.txt`)
    const frPath = join(REWRITES_DIR, categoryDir, `${m.slug}.fr.txt`)

    if (!existsSync(enPath) || !existsSync(frPath)) continue

    const scriptEn = readFileSync(enPath, 'utf-8')
    const scriptFr = readFileSync(frPath, 'utf-8')

    if (scriptEn === m.scriptEn && scriptFr === m.scriptFr) continue

    m.scriptEn = scriptEn
    m.scriptFr = scriptFr
    writeFileSync(join(CONTENT_DIR, `${m.slug}.json`), JSON.stringify(m, null, 2) + '\n')
    console.log(`  Updated: ${m.slug} (${scriptEn.length} EN / ${scriptFr.length} FR chars)`)
    updated++
  }

  console.log(`\nDone. ${updated} meditation(s) updated.`)
}

// ─── POST-PROCESS command ────────────────────────────────────────────────────

function handlePostProcess(): void {
  const args = process.argv.slice(3)
  const slugFlag = args.find(a => !a.startsWith('--'))
  const lang = args.find(a => a.startsWith('--lang='))?.split('=')[1] ?? 'en'
  const all = args.includes('--all')
  const dryRun = args.includes('--dry-run')
  const noWhisper = args.includes('--no-whisper')

  if (!slugFlag && !all) {
    console.error('Provide a slug or --all')
    process.exit(1)
  }

  const slugs = all
    ? loadAllMeditations().filter(m => !m.slug.startsWith('breathe-')).map(m => m.slug)
    : [slugFlag!]

  console.log(`\n=== Post-Processing Pipeline ===`)
  console.log(`Language: ${lang}`)
  console.log(`Meditations: ${slugs.length}`)
  if (dryRun) console.log('(DRY RUN)')
  console.log('')

  for (const slug of slugs) {
    console.log(`\n── ${slug} ──`)

    const med = loadMeditation(slug)
    const hasBreathing = med?.breathing !== null && med?.breathing !== undefined
    const isMediateFamily = med && (
      med.category === 'meditate' ||
      med.category === 'anxiety' ||
      med.category === 'self-compassion' ||
      med.category === 'contemplative' ||
      med.slug.startsWith('meditate-')
    )

    // Step 1: Fix MP3 headers
    console.log('  [1/5] Fix MP3 headers...')
    try {
      run('python3', ['scripts/fix-mp3-headers.py', `audio-storage/${lang}`])
    } catch {
      console.log('    (skipped)')
    }

    if (dryRun) continue

    // Step 2: Segmentation (creates intro/breathing/core/outro segments)
    if (isMediateFamily) {
      console.log('  [2/5] Segmentation...')
      try {
        run('npx', ['tsx', 'scripts/segment-audio.ts', slug, `--lang=${lang}`])
      } catch {
        console.log('    (segmentation failed)')
      }
    } else {
      console.log('  [2/5] Skipping segmentation (not meditate-family)')
    }

    // Step 3: Reconstruct breathing (clip-based, replaces breathing segment + full MP3)
    if (hasBreathing && isMediateFamily) {
      console.log('  [3/5] Breathing reconstruction...')
      try {
        run('python3', ['scripts/reconstruct-breathing.py', slug, `--lang=${lang}`])
      } catch {
        console.log('    (reconstruction failed or no clip bank)')
      }
    } else {
      console.log('  [3/5] Skipping breathing reconstruction')
    }

    // Step 4: Assemble duration variants (10/15/20 min)
    if (isMediateFamily) {
      console.log('  [4/5] Duration assembly...')
      try {
        run('npx', ['tsx', 'scripts/assemble-duration.ts', slug, '--all-durations', `--lang=${lang}`])
      } catch {
        console.log('    (assembly failed)')
      }
    } else {
      console.log('  [4/5] Skipping duration assembly')
    }

    // Step 5: Deploy to public/
    console.log('  [5/5] Copy to public/...')
    try {
      const pubDir = `public/audio/${lang}`
      run('cp', [`audio-storage/${lang}/${slug}.mp3`, `${pubDir}/${slug}.mp3`])
      run('cp', [`audio-storage/${lang}/${slug}.json`, `${pubDir}/${slug}.json`])
    } catch {
      console.log('    (copy failed)')
    }
  }

  console.log('\n=== Post-processing complete ===')
}

// ─── SEGMENT command ─────────────────────────────────────────────────────────

function handleSegment(): void {
  const args = process.argv.slice(3)

  console.log(`\nDelegating to segment-audio.ts...\n`)

  try {
    run('npx', ['tsx', 'scripts/segment-audio.ts', ...args])
  } catch {
    process.exit(1)
  }
}

// ─── SHIP command ────────────────────────────────────────────────────────────
// Single-command slug → shippable result.
// Runs: validate → generate-tts (inline breathing chunks) → qa → copy-to-public.
// Intended workflow: author edits scriptEn/scriptFr in a content JSON, runs
// `pipeline.ts ship <slug>`, listens in the app. Fails hard on QA red.

function handleShip(): void {
  const args = process.argv.slice(3)
  const slug = args.find(a => !a.startsWith('--'))
  const langArg = args.find(a => a.startsWith('--lang='))?.split('=')[1] as 'en' | 'fr' | undefined
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')

  if (!slug) {
    console.error('Usage: pipeline.ts ship <slug> [--lang=en|fr] [--dry-run] [--force]')
    process.exit(1)
  }

  const med = loadMeditation(slug)
  if (!med) {
    console.error(`Meditation not found: ${slug}`)
    process.exit(1)
  }

  // Per-slug lock: prevents two `ship` runs on the same meditation from
  // racing on audio-storage/{lang}/_tmp_* dirs. Cross-meditation parallelism
  // is still allowed (the lockfile is slug-scoped).
  const lockPath = join(AUDIO_DIR, '.locks', `ship-${slug}.lock`)
  let release: () => void = () => {}
  if (!dryRun) {
    try {
      release = acquireLock(lockPath, `ship ${slug}`)
    } catch (e) {
      console.error(`\n✗ Cannot ship ${slug}: ${(e as Error).message}\n`)
      process.exit(1)
    }
  }
  const releaseAndExit = (code: number): never => {
    release()
    process.exit(code)
  }
  process.on('SIGINT', () => releaseAndExit(130))
  process.on('SIGTERM', () => releaseAndExit(143))

  const langs: Array<'en' | 'fr'> = langArg ? [langArg] : (['en', 'fr'] as const).filter(l => {
    const script = l === 'fr' ? med.scriptFr : med.scriptEn
    return script && String(script).trim().length > 0
  }) as Array<'en' | 'fr'>

  console.log(`\n=== Ship ${slug} ===`)
  console.log(`Languages: ${langs.join(', ')}`)
  if (dryRun) console.log('Mode: DRY RUN')
  console.log('')

  for (const lang of langs) {
    console.log(`── ${lang} ──`)

    // 1. Generate TTS + inline breathing clips.
    // Phase C: breathing is now a first-class chunk generated inside
    // generate-tts.ts alongside TTS chunks, authoritative from source script
    // markers. No separate insert-breathing step.
    console.log('  [1/3] TTS + breathing chunks...')
    const ttsArgs = ['tsx', 'scripts/generate-tts.ts', slug, `--lang=${lang}`]
    if (dryRun) ttsArgs.push('--dry-run')
    if (force) ttsArgs.push('--force')
    try {
      run('npx', ttsArgs)
    } catch {
      console.error(`  Generation failed for ${slug} (${lang})`)
      releaseAndExit(1)
    }
    if (dryRun) continue

    // 2. QA gate for this slug
    console.log('  [2/3] QA...')
    try {
      run('npx', ['tsx', 'scripts/qa-meditations.ts', slug, `--lang=${lang}`])
    } catch {
      console.error(`  QA failed for ${slug} (${lang}) — NOT shipping`)
      releaseAndExit(1)
    }

    // 3. Copy to public/audio (canonical deploy surface).
    console.log('  [3/3] Copy to public/audio...')
    const audioSrc = join(AUDIO_DIR, lang)
    const audioDst = join(PROJECT_ROOT, 'public', 'audio', lang)
    if (!existsSync(audioDst)) mkdirSync(audioDst, { recursive: true })
    for (const ext of ['.mp3', '.json']) {
      const src = join(audioSrc, `${slug}${ext}`)
      const dst = join(audioDst, `${slug}${ext}`)
      if (existsSync(src)) cpSync(src, dst)
    }
    console.log('')
  }

  console.log(`=== Ship complete: ${slug} ${langs.join('+')} ===\n`)
  console.log(`Next: visit http://localhost:3100/meditate/${slug}/ or run:`)
  console.log(`  npx tsx scripts/pipeline.ts deploy`)
  release()
}

// ─── ASSEMBLE command ────────────────────────────────────────────────────────

function handleAssemble(): void {
  const args = process.argv.slice(3)

  console.log(`\nDelegating to assemble-duration.ts...\n`)

  try {
    run('npx', ['tsx', 'scripts/assemble-duration.ts', ...args])
  } catch {
    process.exit(1)
  }
}

// ─── Main router ────────────────────────────────────────────────────────────

function main(): void {
  const command = process.argv[2]

  if (!command || command === '--help' || command === '-h') {
    console.log('Vesper Meditation Pipeline')
    console.log('')
    console.log('Commands:')
    console.log('  create         Create skeleton meditation JSON files')
    console.log('  generate-tts   Generate TTS audio (delegates to generate-tts.ts)')
    console.log('  ship           Full pipeline for one slug: TTS → breathing → QA → public/audio')
    console.log('  deploy         QA-gated build, copy, and push to production')
    console.log('  status         Show content status (scripts, audio, missing)')
    console.log('  import         Import scripts from rewrites/ txt files into JSON')
    console.log('  post-process   Run breathing fix + whisper align + segmentation')
    console.log('  segment        Run audio segmentation (delegates to segment-audio.ts)')
    console.log('  assemble       Assemble variable-duration versions')
    console.log('')
    console.log('Examples:')
    console.log('  npx tsx scripts/pipeline.ts create --category=sleep --count=2')
    console.log('  npx tsx scripts/pipeline.ts generate-tts --missing')
    console.log('  npx tsx scripts/pipeline.ts generate-tts --slug=sleep-ocean-drift --lang=en')
    console.log('  npx tsx scripts/pipeline.ts generate-tts --dry-run --slug=sleep-ocean-drift')
    console.log('  npx tsx scripts/pipeline.ts deploy')
    console.log('  npx tsx scripts/pipeline.ts deploy --skip-build --skip-git')
    console.log('  npx tsx scripts/pipeline.ts status')
    console.log('  npx tsx scripts/pipeline.ts import')
    console.log('  npx tsx scripts/pipeline.ts import sleep-ocean-drift')
    console.log('  npx tsx scripts/pipeline.ts post-process <slug> --lang=en')
    console.log('  npx tsx scripts/pipeline.ts post-process --all --lang=en')
    console.log('  npx tsx scripts/pipeline.ts segment --all --lang=en --dry-run')
    console.log('  npx tsx scripts/pipeline.ts assemble <slug> --duration=10 --lang=en')
    process.exit(0)
  }

  switch (command) {
    case 'create':
      handleCreate()
      break
    case 'generate-tts':
      handleGenerateTTS()
      break
    case 'ship':
      handleShip()
      break
    case 'deploy':
      handleDeploy()
      break
    case 'status':
      handleStatus()
      break
    case 'import':
      handleImport()
      break
    case 'post-process':
      handlePostProcess()
      break
    case 'segment':
      handleSegment()
      break
    case 'assemble':
      handleAssemble()
      break
    default:
      console.error(`Unknown command: ${command}`)
      console.log('Run with --help for usage.')
      process.exit(1)
  }
}

main()
