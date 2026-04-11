/**
 * Insert clip-based breathing audio at the [BREATHING_SECTION] marker.
 *
 * The TTS was generated WITHOUT breathing counting (stripped by prepareScript).
 * This script finds the marker in the alignment, builds precisely-timed
 * breathing audio from the clip bank, and splices it in.
 *
 * Usage:
 *   npx tsx scripts/insert-breathing.ts <slug> --lang=en
 *   npx tsx scripts/insert-breathing.ts --all --lang=en
 *   npx tsx scripts/insert-breathing.ts <slug> --dry-run
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync, rmSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync, spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const CONTENT_DIR = join(PROJECT_ROOT, 'src', 'content', 'meditations')
const AUDIO_DIR = join(PROJECT_ROOT, 'audio-storage')

// ─── Types ──────────────────────────────────────────────────────────────────

interface AlignmentJSON {
  lines: string[]
  timestamps: Array<{ start: number; end: number }>
  duration: number
}

interface MeditationJSON {
  slug: string
  category: string
  breathing: {
    slug: string
    inhale: number
    holdIn: number
    exhale: number
    holdOut: number
    rounds: number
  } | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDuration(path: string): number {
  const out = execFileSync('ffprobe', [
    '-v', 'quiet', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', path,
  ], { encoding: 'utf-8' }).trim()
  return parseFloat(out)
}

// ─── Main ───────────────────────────────────────────────────────────────────

function insertBreathing(slug: string, lang: string, dryRun: boolean): boolean {
  console.log(`\n  ${slug} (${lang}):`)

  // Load meditation JSON
  const medPath = join(CONTENT_DIR, `${slug}.json`)
  if (!existsSync(medPath)) {
    console.error(`    Meditation not found: ${slug}`)
    return false
  }
  const med: MeditationJSON = JSON.parse(readFileSync(medPath, 'utf-8'))

  if (!med.breathing) {
    console.log(`    No breathing pattern — skipping`)
    return true
  }

  // Load alignment
  const alignPath = join(AUDIO_DIR, lang, `${slug}.json`)
  const mp3Path = join(AUDIO_DIR, lang, `${slug}.mp3`)
  if (!existsSync(alignPath) || !existsSync(mp3Path)) {
    console.error(`    Audio/alignment not found in audio-storage/${lang}/`)
    return false
  }

  // IDEMPOTENCY: always work from the clean TTS source, never from a previous
  // insert-breathing run's output. Without this, re-running after a scriptFr
  // edit leaves stale breathing baked into the audio (the bug that caused
  // meditate-anxiety-release FR to have 9 "last one" announcements).
  const ttsOriginalMp3 = mp3Path.replace('.mp3', '.tts-original.mp3')
  const ttsOriginalJson = alignPath.replace('.json', '.tts-original.json')

  if (!existsSync(ttsOriginalMp3)) {
    // First run for this meditation: snapshot the clean TTS output.
    cpSync(mp3Path, ttsOriginalMp3)
    cpSync(alignPath, ttsOriginalJson)
    console.log(`    Saved TTS original snapshot`)
  } else {
    // Subsequent run: restore from the clean source before processing.
    cpSync(ttsOriginalMp3, mp3Path)
    cpSync(ttsOriginalJson, alignPath)
    console.log(`    Restored from TTS original (idempotent re-run)`)
  }

  const alignment: AlignmentJSON = JSON.parse(readFileSync(alignPath, 'utf-8'))

  // Find ALL [BREATHING_SECTION] markers
  const markerIndices = alignment.lines
    .map((l, i) => l.includes('BREATHING_SECTION') ? i : -1)
    .filter(i => i >= 0)
  if (markerIndices.length === 0) {
    console.log(`    No [BREATHING_SECTION] marker — skipping (legacy audio)`)
    return true
  }

  // Process from last to first. Since we always restored from tts-original
  // above, the initial indices are valid, and processing in reverse keeps
  // earlier indices valid through each iteration (we only mutate content
  // AT or AFTER markerIdx).
  for (const markerIdx of [...markerIndices].reverse()) {
    console.log(`    Processing marker at line ${markerIdx}...`)
    if (!insertBreathingAtMarker(slug, lang, med, mp3Path, alignPath, markerIdx, dryRun)) {
      return false
    }
  }

  return true
}

/** Insert breathing audio at a specific marker index */
function insertBreathingAtMarker(
  slug: string,
  lang: string,
  med: MeditationJSON,
  mp3Path: string,
  alignPath: string,
  markerIdx: number,
  dryRun: boolean,
): boolean {
  const alignment: AlignmentJSON = JSON.parse(readFileSync(alignPath, 'utf-8'))
  const { inhale, holdIn, exhale, holdOut, rounds } = med.breathing!

  // Don't trust alignment timestamps — they can be 5-10s off.
  // Use silencedetect to find the actual silence gap where the marker is.
  const markerTs = alignment.timestamps[markerIdx]
  const roughTime = markerTs.start
  console.log(`    Marker at line ${markerIdx}, alignment says ${roughTime.toFixed(1)}s`)

  // Search for the longest silence in a window around the marker
  const searchStart = Math.max(0, roughTime - 15)
  const searchEnd = roughTime + 15
  let insertTime = roughTime

  {
    const sd = spawnSync('ffmpeg', [
      '-i', mp3Path, '-ss', String(searchStart), '-t', String(searchEnd - searchStart),
      '-af', 'silencedetect=noise=-30dB:d=0.5',
      '-f', 'null', '-',
    ], { encoding: 'utf-8' })
    const stderr = sd.stderr ?? ''
    const silences: Array<{ start: number; dur: number }> = []
    // Parse silence_start lines, then find the matching silence_duration on the next silence_end line
    const sdLines = stderr.split('\n')
    let pendingStart = -1
    for (const line of sdLines) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/)
      if (startMatch) {
        pendingStart = parseFloat(startMatch[1]) + searchStart
      }
      const durMatch = line.match(/silence_duration:\s*([\d.]+)/)
      if (durMatch && pendingStart >= 0) {
        silences.push({ start: pendingStart, dur: parseFloat(durMatch[1]) })
        pendingStart = -1
      }
    }

    if (silences.length > 0) {
      // Pick the silence closest to the marker timestamp (not the longest)
      const best = silences.reduce((a, b) =>
        Math.abs(b.start - roughTime) < Math.abs(a.start - roughTime) ? b : a
      )
      insertTime = best.start + 0.1
      console.log(`    Actual silence at ${best.start.toFixed(1)}s (${best.dur.toFixed(1)}s gap) — inserting at ${insertTime.toFixed(1)}s`)
    } else {
      console.log(`    No silence detected — using alignment time ${insertTime.toFixed(1)}s`)
    }
  }

  // Note: tts-original snapshot + restore happens in insertBreathing() above,
  // not here, so this function always works against a clean/restored source.

  // Build breathing audio
  console.log(`    Pattern: ${inhale}-${holdIn}-${exhale}-${holdOut} × ${rounds}`)

  if (dryRun) {
    const INTER_PHASE_GAP = 0.5
    const INTER_ROUND_GAP = 2.0
    const phases = [inhale, holdIn, exhale, holdOut].filter(v => v > 0)
    const cycleDur = phases.reduce((a, b) => a + b, 0)
    const gapsPerRound = (phases.length - 1) * INTER_PHASE_GAP
    const total = (cycleDur + gapsPerRound) * rounds + (rounds - 1) * INTER_ROUND_GAP
    console.log(`    Breathing duration: ${total.toFixed(1)}s`)
    console.log(`    Final duration: ~${(alignment.duration + total).toFixed(1)}s`)
    return true
  }

  // Generate breathing audio via reconstruct-breathing.py (just the breathing track)
  // We call it with a special flag that only generates the WAV, doesn't assemble
  console.log(`    Generating breathing audio...`)
  try {
    execFileSync('python3', [
      join(PROJECT_ROOT, 'scripts', 'reconstruct-breathing.py'),
      slug, `--lang=${lang}`, '--breathing-only',
    ], { cwd: PROJECT_ROOT, stdio: 'pipe' })
  } catch (e) {
    // reconstruct-breathing.py doesn't have --breathing-only yet
    // Fall back to calling it directly and using the breathing.mp3 it produces
  }

  // Actually, let's just build the breathing audio inline with ffmpeg
  // since we have the clips and the logic is simple
  const breathingMp3 = buildBreathingAudio(med, lang)
  if (!breathingMp3) {
    console.error(`    Failed to build breathing audio`)
    return false
  }

  const breathingDur = getDuration(breathingMp3)
  console.log(`    Breathing audio: ${breathingDur.toFixed(1)}s`)

  // Split the original MP3 at the marker point and insert breathing
  // Write to a separate output file — never modify the TTS source in place
  const tmpDir = join(AUDIO_DIR, lang, '_tmp_insert')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  const preMp3 = join(tmpDir, 'pre.mp3')
  const postMp3 = join(tmpDir, 'post.mp3')

  // Cut pre-marker (re-encode for precise cut)
  execFileSync('ffmpeg', [
    '-y', '-i', mp3Path,
    '-t', insertTime.toFixed(3),
    '-q:a', '2', preMp3,
  ], { stdio: 'pipe' })

  // Cut post-marker
  // Find where spoken content resumes after the marker silence.
  // Guard against corrupted ElevenLabs alignments where consecutive lines
  // collapse into the same timestamp (seen as a >20s "long pause" span with
  // zero-width internal timestamps). When detected, skip past the corrupted
  // region and fall back to the silencedetect estimate if nothing looks clean.
  let resumeTime = insertTime
  let resumeFound = false
  for (let i = markerIdx + 1; i < alignment.lines.length; i++) {
    const clean = alignment.lines[i].replace(/\[(long|short)\s+pause\]/g, '').trim()
    if (!clean) continue
    const ts = alignment.timestamps[i]
    // Reject timestamps that are before or equal to the cut point (would cause
    // a reverse/zero-length post segment) — happens with collapsed regions.
    if (ts.start <= insertTime + 0.05) continue
    resumeTime = ts.start
    resumeFound = true
    break
  }
  if (!resumeFound) {
    // Corrupted alignment: fall back to a conservative jump past the rough
    // silence window.  Assumes the spoken content resumes within ~2s of the
    // cut point.  Better than overlapping or skipping content.
    resumeTime = Math.max(insertTime + 0.5, roughTime + 2)
    console.warn(`    ⚠ corrupted alignment near marker ${markerIdx} — using fallback resumeTime ${resumeTime.toFixed(1)}s`)
  }
  // Hard invariant: resumeTime must be strictly after insertTime or ffmpeg
  // will produce a zero-length / reversed post segment and the concat will
  // silently drop content.
  if (resumeTime <= insertTime) {
    console.error(`    ✗ invariant violated: resumeTime=${resumeTime} ≤ insertTime=${insertTime}`)
    return false
  }

  execFileSync('ffmpeg', [
    '-y', '-i', mp3Path,
    '-ss', resumeTime.toFixed(3),
    '-q:a', '2', postMp3,
  ], { stdio: 'pipe' })

  // Concatenate: pre + breathing + post
  const concatList = join(tmpDir, 'concat.txt')
  writeFileSync(concatList, `file '${preMp3}'\nfile '${breathingMp3}'\nfile '${postMp3}'`)

  const finalMp3 = join(tmpDir, 'final.mp3')
  execFileSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatList, '-q:a', '2', finalMp3,
  ], { stdio: 'pipe' })

  const finalDur = getDuration(finalMp3)
  console.log(`    Final: ${finalDur.toFixed(1)}s (was ${alignment.duration.toFixed(1)}s)`)

  // Write final to audio-storage (overwrite the TTS-only version)
  cpSync(finalMp3, mp3Path)

  // Build new alignment
  const preDur = getDuration(preMp3)
  const postDur = getDuration(postMp3)
  const delta = breathingDur - (resumeTime - insertTime)

  const newLines: string[] = []
  const newTs: Array<{ start: number; end: number }> = []

  // Pre-marker lines (unchanged)
  for (let i = 0; i < markerIdx; i++) {
    newLines.push(alignment.lines[i])
    newTs.push(alignment.timestamps[i])
  }

  // Breathing instruction lines
  const INTER_PHASE_GAP = 0.5
  const INTER_ROUND_GAP = 2.0
  // Captions must match the voice clips that will actually play (koraly = FR,
  // katherine = EN — see buildBreathingAudio voice selection). Without
  // per-language labels the player would display English text over French
  // audio. Labels are keyed [first, again, middle, last] matching the clip
  // variant selection logic below (r===1 → first; r===2 → again;
  // r===rounds → last; else → middle).
  const INSTR_LABELS: Record<string, Record<string, string[]>> = {
    en: {
      inhale:   ['Breathe in through your nose for four.', 'Again. In for four.',   'In for four.',  'One more. In for four.'],
      hold_in:  ['Hold gently for four.',                   'Hold for four.',          'Hold for four.', 'Hold for four.'],
      exhale:   ['Exhale slowly through your mouth.',       'Out for four.',           'Out for four.',  'Out for four.'],
      hold_out: ['And hold for four.',                      'Hold for four.',          'Hold for four.', 'Hold for four.'],
    },
    fr: {
      inhale:   ['Inspirez par le nez, quatre temps.',      'Encore. Inspirez sur quatre.', 'Inspirez sur quatre.', 'Une dernière fois. Inspirez sur quatre.'],
      hold_in:  ['Retenez doucement sur quatre.',           'Retenez sur quatre.',          'Retenez sur quatre.',  'Retenez sur quatre.'],
      exhale:   ['Expirez par la bouche, quatre temps.',    'Expirez sur quatre.',          'Expirez sur quatre.',  'Expirez sur quatre.'],
      hold_out: ['Et retenez sur quatre.',                  'Retenez sur quatre.',          'Retenez sur quatre.',  'Retenez sur quatre.'],
    },
  }
  const instrLabels = INSTR_LABELS[lang] ?? INSTR_LABELS.en

  const phases: Array<[string, number]> = []
  if (inhale > 0) phases.push(['inhale', inhale])
  if (holdIn > 0) phases.push(['hold_in', holdIn])
  if (exhale > 0) phases.push(['exhale', exhale])
  if (holdOut > 0) phases.push(['hold_out', holdOut])

  let cursor = preDur
  for (let r = 1; r <= rounds; r++) {
    for (let p = 0; p < phases.length; p++) {
      const [type, dur] = phases[p]
      const labels = instrLabels[type] ?? ['...']
      // Index mirrors buildBreathingAudio clip variant selection:
      //   [0]=first (round 1), [1]=again (round 2 inhale),
      //   [2]=middle (rounds 3..n-1), [3]=last (final round inhale).
      // Order: check "last" BEFORE "again" so rounds===2 final round
      // correctly picks "last" (previously picked "again" due to wrong order).
      let label: string
      if (r === 1) label = labels[0]
      else if (r === rounds && type === 'inhale') label = labels[Math.min(3, labels.length - 1)]
      else if (r === 2 && type === 'inhale') label = labels[Math.min(1, labels.length - 1)]
      else label = labels[Math.min(2, labels.length - 1)]

      const end = cursor + dur
      newLines.push(label)
      newTs.push({ start: Math.round(cursor * 1000) / 1000, end: Math.round(end * 1000) / 1000 })
      cursor = end

      if (p < phases.length - 1) cursor += INTER_PHASE_GAP
      else if (r < rounds) cursor += INTER_ROUND_GAP
    }
  }

  // Post-marker lines (shifted)
  // Find where post-marker spoken lines start in original alignment
  let postStartIdx = markerIdx + 1
  for (let i = markerIdx + 1; i < alignment.lines.length; i++) {
    const clean = alignment.lines[i].replace(/\[(long|short)\s+pause\]/g, '').trim()
    if (clean) {
      postStartIdx = i
      break
    }
  }

  for (let i = postStartIdx; i < alignment.lines.length; i++) {
    newLines.push(alignment.lines[i])
    const ts = alignment.timestamps[i]
    newTs.push({
      start: Math.round((ts.start + delta) * 1000) / 1000,
      end: Math.round((ts.end + delta) * 1000) / 1000,
    })
  }

  const newAlignment: AlignmentJSON = {
    lines: newLines,
    timestamps: newTs,
    duration: finalDur,
  }

  writeFileSync(alignPath, JSON.stringify(newAlignment, null, 2) + '\n')
  console.log(`    Alignment: ${newLines.length} lines`)

  // Copy to public/
  const pubMp3 = join(PROJECT_ROOT, 'public', 'audio', lang, `${slug}.mp3`)
  const pubJson = join(PROJECT_ROOT, 'public', 'audio', lang, `${slug}.json`)
  if (existsSync(dirname(pubMp3))) {
    cpSync(mp3Path, pubMp3)
    cpSync(alignPath, pubJson)
    console.log(`    Copied to public/audio/${lang}/`)
  }

  // Cleanup
  try { rmSync(tmpDir, { recursive: true }) } catch { /* non-critical */ }

  return true
}

// ─── Build breathing audio ──────────────────────────────────────────────────

function buildBreathingAudio(med: MeditationJSON, lang: string): string | null {
  if (!med.breathing) return null

  const { inhale, holdIn, exhale, holdOut, rounds } = med.breathing
  const INTER_PHASE_GAP = 0.5
  const INTER_ROUND_GAP = 2.0

  const voiceName = lang === 'fr' ? 'koraly' : 'katherine'
  const clipsDir = join(AUDIO_DIR, 'clips', lang === 'fr' ? 'fr' : 'en', voiceName)
  const instrDir = join(clipsDir, 'instructions')

  if (!existsSync(instrDir)) {
    console.error(`    Clip bank not found: ${instrDir}`)
    return null
  }

  // Clip name templates — {count} suffix appended for count-specific clips
  const instrMapBase: Record<string, Record<string, string>> = {
    inhale: { first: 'breathe-in-long', again: 'again-in', middle: 'in', last: 'one-more-in' },
    hold_in: { first: 'hold-gently', again: 'hold', middle: 'hold', last: 'hold' },
    exhale: { first: 'breathe-out-long', again: 'out', middle: 'out', last: 'out' },
    hold_out: { first: 'hold-bottom', again: 'hold', middle: 'hold', last: 'hold' },
  }

  // Resolve clip filename: prefer count-specific (e.g. hold-7.mp3), fall back to default (hold.mp3)
  function resolveClip(baseName: string, count: number): string {
    const countSpecific = join(instrDir, `${baseName}-${count}.mp3`)
    if (existsSync(countSpecific)) return countSpecific
    const fallback = join(instrDir, `${baseName}.mp3`)
    if (existsSync(fallback)) return fallback
    return countSpecific // will error in caller
  }

  const phases: Array<[string, number]> = []
  if (inhale > 0) phases.push(['inhale', inhale])
  if (holdIn > 0) phases.push(['hold_in', holdIn])
  if (exhale > 0) phases.push(['exhale', exhale])
  if (holdOut > 0) phases.push(['hold_out', holdOut])

  const tmpDir = join(AUDIO_DIR, lang, '_tmp_breathing')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  // Generate silence files
  const silencePhase = join(tmpDir, 'gap_phase.wav')
  const silenceRound = join(tmpDir, 'gap_round.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i',
    `anullsrc=r=44100:cl=mono:d=${INTER_PHASE_GAP}`,
    '-t', String(INTER_PHASE_GAP), silencePhase], { stdio: 'pipe' })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i',
    `anullsrc=r=44100:cl=mono:d=${INTER_ROUND_GAP}`,
    '-t', String(INTER_ROUND_GAP), silenceRound], { stdio: 'pipe' })

  const phaseFiles: string[] = []

  for (let r = 1; r <= rounds; r++) {
    for (let p = 0; p < phases.length; p++) {
      const [type, dur] = phases[p]

      // Pick instruction clip (count-aware)
      const variants = instrMapBase[type] ?? instrMapBase['inhale']
      let baseName: string
      if (r === 1) baseName = variants['first']
      else if (r === 2 && type === 'inhale') baseName = variants['again']
      else if (r === rounds && type === 'inhale') baseName = variants['last']
      else baseName = variants['middle']

      const clipPath = resolveClip(baseName, dur)
      if (!existsSync(clipPath)) {
        console.error(`    Missing clip: ${clipPath}`)
        return null
      }

      // Render phase: clip padded with silence to exact duration
      const phaseWav = join(tmpDir, `phase_${r}_${p}.wav`)
      execFileSync('ffmpeg', [
        '-y', '-i', clipPath,
        '-af', `apad=whole_dur=${dur}`,
        '-t', String(dur),
        '-ar', '44100', '-ac', '1', phaseWav,
      ], { stdio: 'pipe' })

      phaseFiles.push(phaseWav)

      // Add gap
      if (p < phases.length - 1) {
        phaseFiles.push(silencePhase)
      } else if (r < rounds) {
        phaseFiles.push(silenceRound)
      }
    }
  }

  // Concat all phases
  const concatList = join(tmpDir, 'concat.txt')
  writeFileSync(concatList, phaseFiles.map(f => `file '${f}'`).join('\n'))

  const breathingMp3 = join(tmpDir, 'breathing.mp3')
  execFileSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatList, '-q:a', '2', '-ar', '44100', breathingMp3,
  ], { stdio: 'pipe' })

  return breathingMp3
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2)
  const slugArg = args.find(a => !a.startsWith('--'))
  const lang = args.find(a => a.startsWith('--lang='))?.split('=')[1] ?? 'en'
  const dryRun = args.includes('--dry-run')
  const all = args.includes('--all')

  if (!slugArg && !all) {
    console.log('Usage:')
    console.log('  npx tsx scripts/insert-breathing.ts <slug> --lang=en')
    console.log('  npx tsx scripts/insert-breathing.ts --all --lang=en')
    console.log('  npx tsx scripts/insert-breathing.ts <slug> --dry-run')
    process.exit(1)
  }

  const slugs = all
    ? readdirSync(CONTENT_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf-8')))
        .filter((m: MeditationJSON) => m.breathing !== null)
        .map((m: MeditationJSON) => m.slug)
        .sort()
    : [slugArg!]

  console.log(`\n=== Insert Breathing ${dryRun ? '(DRY RUN)' : ''} ===`)
  console.log(`Language: ${lang}, Meditations: ${slugs.length}`)

  let ok = 0
  let fail = 0
  for (const slug of slugs) {
    if (insertBreathing(slug, lang, dryRun)) ok++
    else fail++
  }

  console.log(`\n=== Done: ${ok} OK, ${fail} failed ===`)
}

main()
