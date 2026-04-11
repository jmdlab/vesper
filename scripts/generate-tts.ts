/**
 * TTS generation script — reads meditation data from static JSON files
 * in src/content/meditations/ and generates audio via ElevenLabs API.
 *
 * Usage:
 *   npx tsx scripts/generate-tts.ts <slug>                    # EN+FR
 *   npx tsx scripts/generate-tts.ts <slug> --lang=en          # One language
 *   npx tsx scripts/generate-tts.ts --all                     # All meditations
 *   npx tsx scripts/generate-tts.ts --missing                 # Only meditations without audio
 *   npx tsx scripts/generate-tts.ts <slug> --voice=<voiceId>  # Override voice
 *   npx tsx scripts/generate-tts.ts <slug> --outdir=audio-storage-v2  # Override output dir
 *   npx tsx scripts/generate-tts.ts --dry-run <slug>          # Preview prepared text, no API call
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, cpSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { prepareScript, chunkText, getVoiceSettings } from './prepare-tts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const CONTENT_DIR = join(PROJECT_ROOT, 'src', 'content', 'meditations')
const DEFAULT_OUTPUT_DIR = join(PROJECT_ROOT, 'audio-storage')

const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech'
const API_KEY = process.env.ELEVENLABS_API_KEY ?? ''
const MODEL_ID = 'eleven_v3'

// Default voice IDs (Katherine v1 and a FR voice)
const DEFAULT_VOICE_EN = process.env.ELEVENLABS_VOICE_EN ?? 'NtS6nEHDYMQC9QczMQuq'
const DEFAULT_VOICE_FR = process.env.ELEVENLABS_VOICE_FR ?? 'TojRWZatQyy9dujEdiQ1'

interface MeditationJSON {
  slug: string
  titleEn: string
  titleFr: string
  scriptEn: string
  scriptFr: string
  category: string
  audioPathEn: string | null
  audioPathFr: string | null
  [key: string]: unknown
}

interface TTSResult {
  audio: Buffer
  requestId: string
  alignment: {
    characters: string[]
    character_start_times_seconds: number[]
    character_end_times_seconds: number[]
  } | null
}

/** Load a meditation JSON from the content directory */
function loadMeditation(slug: string): MeditationJSON | null {
  const filePath = join(CONTENT_DIR, `${slug}.json`)
  if (!existsSync(filePath)) return null
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

/** Load all meditation JSONs */
function loadAllMeditations(): MeditationJSON[] {
  const files = readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'))
  return files.map(f => JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf-8')))
}

/** Update the audioPath field in a meditation JSON file */
function updateAudioPath(slug: string, lang: 'en' | 'fr', audioPath: string): void {
  const filePath = join(CONTENT_DIR, `${slug}.json`)
  const data = JSON.parse(readFileSync(filePath, 'utf-8'))
  const key = lang === 'fr' ? 'audioPathFr' : 'audioPathEn'
  data[key] = audioPath
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
}

/**
 * Call ElevenLabs API for a single text chunk.
 * Uses /with-timestamps endpoint for character-level timing data.
 */
async function callTTS(
  text: string,
  voiceId: string,
  voiceSettings: Record<string, unknown>,
): Promise<TTSResult> {
  const url = `${API_BASE}/${voiceId}/with-timestamps?output_format=mp3_44100_128`

  const body = {
    text,
    model_id: MODEL_ID,
    voice_settings: voiceSettings,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`)
  }

  const json = await response.json() as Record<string, unknown>
  const requestId = response.headers.get('request-id') ?? ''
  const audio = Buffer.from(json.audio_base64 as string, 'base64')
  const alignment = (json.normalized_alignment ?? json.alignment ?? null) as TTSResult['alignment']

  return { audio, requestId, alignment }
}

async function generateForMeditation(
  slug: string,
  options: {
    lang?: 'en' | 'fr'
    voiceOverride?: string
    outDirOverride?: string
    dryRun?: boolean
    force?: boolean
  } = {},
): Promise<void> {
  const meditation = loadMeditation(slug)
  if (!meditation) {
    console.error(`  Meditation not found: ${slug}`)
    return
  }

  const langs = options.lang ? [options.lang] : (['en', 'fr'] as const)
  const voiceSettings = getVoiceSettings(meditation.category)
  const baseOutDir = options.outDirOverride
    ? join(PROJECT_ROOT, options.outDirOverride)
    : DEFAULT_OUTPUT_DIR

  for (const l of langs) {
    const rawScript = l === 'fr' ? meditation.scriptFr : meditation.scriptEn
    if (!rawScript || rawScript.trim().length === 0) {
      console.log(`  Skipping ${slug} (${l}) — no script content`)
      continue
    }

    const voiceId = options.voiceOverride ?? (l === 'fr' ? DEFAULT_VOICE_FR : DEFAULT_VOICE_EN)
    const outDir = join(baseOutDir, l)
    const outPath = join(outDir, `${slug}.mp3`)

    // Dry-run always computes/previews, even if audio exists — otherwise
    // the pipeline has no way to preview billable chars for a re-generation.
    if (existsSync(outPath) && !options.force && !options.dryRun) {
      console.log(`  Skipping ${slug} (${l}) — audio already exists (use --force to regenerate)`)
      continue
    }

    const hasBreathing = (meditation as unknown as { breathing: unknown }).breathing != null
    const prepared = prepareScript(rawScript, meditation.category, hasBreathing)
    // Replace [BREATHING_SECTION] with a short silence marker for TTS.
    // The actual breathing audio gets inserted in post-processing.
    const ttsReady = prepared.replaceAll(
      '[BREATHING_SECTION]',
      '[long pause] [long pause] [long pause]',
    )
    const chunks = chunkText(ttsReady)

    if (options.dryRun) {
      console.log(`\n--- DRY RUN: ${slug} (${l}) [${meditation.category}] ---`)
      console.log(`Prepared text (${prepared.length} chars, ${chunks.length} chunk(s)):`)
      console.log(prepared.slice(0, 500))
      if (prepared.length > 500) console.log(`... (${prepared.length - 500} more chars)`)
      console.log('---')
      continue
    }

    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

    console.log(`\n  Generating ${slug} (${l}) [${meditation.category}]...`)
    console.log(`    ${chunks.length} chunk(s), ${prepared.length} chars`)

    const buffers: Buffer[] = []
    const requestIds: string[] = []
    const allAlignments: TTSResult['alignment'][] = []
    let chunkTimeOffset = 0

    for (let i = 0; i < chunks.length; i++) {
      // Skip chunks that are empty or only whitespace/pauses after preparation
      const trimmedChunk = chunks[i].replace(/\[.*?\]/g, '').trim()
      if (!trimmedChunk) {
        console.log(`    Chunk ${i + 1}/${chunks.length} — skipped (empty after preparation)`)
        continue
      }
      console.log(`    Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`)
      const { audio, requestId, alignment } = await callTTS(chunks[i], voiceId, voiceSettings)
      buffers.push(audio)
      if (requestId) requestIds.push(requestId)

      // Offset alignment times for multi-chunk concatenation
      if (alignment && chunkTimeOffset > 0) {
        alignment.character_start_times_seconds = alignment.character_start_times_seconds.map(
          (t: number) => t + chunkTimeOffset,
        )
        alignment.character_end_times_seconds = alignment.character_end_times_seconds.map(
          (t: number) => t + chunkTimeOffset,
        )
      }
      if (alignment) {
        // Use actual audio duration (not alignment end time) for chunk offset.
        // Alignment timestamps don't include silence from [long pause] tags,
        // so using them causes cumulative drift in multi-chunk concatenation.
        const tmpPath = join(outDir, `_chunk_tmp.mp3`)
        writeFileSync(tmpPath, audio)
        const actualDur = parseFloat(
          execFileSync('ffprobe', [
            '-v', 'quiet', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', tmpPath,
          ], { encoding: 'utf-8' }).trim()
        )
        try { unlinkSync(tmpPath) } catch {}
        chunkTimeOffset += actualDur
      }
      allAlignments.push(alignment)

      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200))
    }

    // Merge alignments
    const mergedAlignment = {
      characters: allAlignments.flatMap(a => a?.characters ?? []),
      character_start_times_seconds: allAlignments.flatMap(a => a?.character_start_times_seconds ?? []),
      character_end_times_seconds: allAlignments.flatMap(a => a?.character_end_times_seconds ?? []),
    }

    // Convert character-level timestamps to line-level timestamps.
    // Strategy: find newline characters in the alignment character array to
    // split into lines, then take min(start) and max(end) per line.
    const preparedLines = prepared.split('\n').filter(line => line.trim().length > 0)
    const lineTimestamps: Array<{ start: number; end: number }> = []

    // Group character indices by line using newline positions
    const charGroups: number[][] = []
    let currentGroup: number[] = []
    for (let ci = 0; ci < mergedAlignment.characters.length; ci++) {
      if (mergedAlignment.characters[ci] === '\n') {
        if (currentGroup.length > 0) charGroups.push(currentGroup)
        currentGroup = []
      } else {
        currentGroup.push(ci)
      }
    }
    if (currentGroup.length > 0) charGroups.push(currentGroup)

    // Filter out groups that are only whitespace/empty (blank lines between prepared lines)
    const nonEmptyGroups = charGroups.filter(group =>
      group.some(ci => mergedAlignment.characters[ci]?.trim() !== '')
    )

    // Map each prepared line to its character group
    for (let li = 0; li < preparedLines.length; li++) {
      if (li < nonEmptyGroups.length) {
        const group = nonEmptyGroups[li]
        const starts = group
          .map(ci => mergedAlignment.character_start_times_seconds[ci])
          .filter((t): t is number => t !== undefined && t > 0)
        const ends = group
          .map(ci => mergedAlignment.character_end_times_seconds[ci])
          .filter((t): t is number => t !== undefined && t > 0)

        const start = starts.length > 0 ? Math.min(...starts) : (lineTimestamps.length > 0 ? lineTimestamps[lineTimestamps.length - 1].end : 0)
        const end = ends.length > 0 ? Math.max(...ends) : start
        lineTimestamps.push({ start, end })
      } else {
        // Fallback: extrapolate from last known timestamp
        const prev = lineTimestamps.length > 0 ? lineTimestamps[lineTimestamps.length - 1].end : 0
        lineTimestamps.push({ start: prev, end: prev })
      }
    }

    // Write audio and fix Xing header for correct mobile duration
    const combined = Buffer.concat(buffers)
    writeFileSync(outPath, combined)
    // Invalidate any stale insert-breathing snapshot so the next run re-creates
    // it from this fresh TTS output. Without this, editing scriptEn/scriptFr
    // and re-running the pipeline would silently ship the pre-edit audio.
    const staleMp3 = outPath.replace('.mp3', '.tts-original.mp3')
    const staleJson = outPath.replace('.mp3', '.tts-original.json')
    for (const p of [staleMp3, staleJson]) {
      if (existsSync(p)) { try { unlinkSync(p) } catch { /* ignore */ } }
    }
    if (buffers.length > 1) {
      try {
        execFileSync('python3', [join(PROJECT_ROOT, 'scripts', 'fix-mp3-headers.py'), outDir])
      } catch {
        console.warn('    Warning: could not fix MP3 Xing header (mobile may show wrong duration)')
      }
    }

    // Write alignment JSON alongside the audio
    const alignPath = join(outDir, `${slug}.json`)
    writeFileSync(alignPath, JSON.stringify({
      lines: preparedLines,
      timestamps: lineTimestamps,
      duration: chunkTimeOffset,
    }))

    // Update the meditation JSON with the audio path
    const audioWebPath = `/audio/${l}/${slug}.mp3`
    updateAudioPath(slug, l, audioWebPath)

    // Copy to public/audio/ for serving
    const pubDir = join(PROJECT_ROOT, 'public', 'audio', l)
    mkdirSync(pubDir, { recursive: true })
    cpSync(outPath, join(pubDir, `${slug}.mp3`))
    cpSync(alignPath, join(pubDir, `${slug}.json`))

    const sizeMB = (statSync(outPath).size / 1024 / 1024).toFixed(1)
    console.log(`    Done: ${outPath} (${sizeMB} MB)`)
    console.log(`    Alignment: ${alignPath} (${lineTimestamps.length} lines)`)
    console.log(`    Updated JSON: audioPath${l === 'fr' ? 'Fr' : 'En'} = ${audioWebPath}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const slugArg = args.find(a => !a.startsWith('--'))
  const langArg = args.find(a => a.startsWith('--lang='))?.split('=')[1] as 'en' | 'fr' | undefined
  const voiceOverride = args.find(a => a.startsWith('--voice='))?.split('=')[1]
  const outDirOverride = args.find(a => a.startsWith('--outdir='))?.split('=')[1]
  const allFlag = args.includes('--all')
  const missingFlag = args.includes('--missing')
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')

  if (!slugArg && !allFlag && !missingFlag) {
    console.log('Vesper TTS Generation')
    console.log('')
    console.log('Usage:')
    console.log('  npx tsx scripts/generate-tts.ts <slug>                  # Generate EN+FR audio')
    console.log('  npx tsx scripts/generate-tts.ts <slug> --lang=en        # One language only')
    console.log('  npx tsx scripts/generate-tts.ts --all                   # All meditations')
    console.log('  npx tsx scripts/generate-tts.ts --missing               # Only missing audio')
    console.log('  npx tsx scripts/generate-tts.ts <slug> --voice=<id>     # Override voice ID')
    console.log('  npx tsx scripts/generate-tts.ts <slug> --outdir=<dir>   # Override output dir')
    console.log('  npx tsx scripts/generate-tts.ts --dry-run <slug>        # Preview, no API call')
    console.log('  npx tsx scripts/generate-tts.ts <slug> --force          # Regenerate even if exists')
    process.exit(0)
  }

  if (!dryRun && !API_KEY) {
    console.error('ELEVENLABS_API_KEY not set. Use --dry-run to preview without API calls.')
    process.exit(1)
  }

  console.log('=== Vesper TTS Generation ===')
  console.log(`Source: ${CONTENT_DIR}`)
  console.log(`Output: ${outDirOverride ? join(PROJECT_ROOT, outDirOverride) : DEFAULT_OUTPUT_DIR}`)
  console.log(`Model: ${MODEL_ID}`)
  if (dryRun) console.log('Mode: DRY RUN (no API calls)')
  if (voiceOverride) console.log(`Voice override: ${voiceOverride}`)
  console.log('')

  const options = { lang: langArg, voiceOverride, outDirOverride, dryRun, force }

  if (allFlag || missingFlag) {
    const meditations = loadAllMeditations()
      .filter(m => m.category !== 'breathe') // Breathing exercises use browser TTS
      .sort((a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug))

    if (missingFlag) {
      const missing = meditations.filter(m => {
        const enExists = existsSync(join(DEFAULT_OUTPUT_DIR, 'en', `${m.slug}.mp3`))
        const frExists = existsSync(join(DEFAULT_OUTPUT_DIR, 'fr', `${m.slug}.mp3`))
        return !enExists || !frExists
      })
      console.log(`Found ${missing.length} meditations with missing audio (of ${meditations.length} total)`)
      for (const m of missing) {
        await generateForMeditation(m.slug, options)
      }
    } else {
      console.log(`Generating ${meditations.length} meditations...`)
      for (const m of meditations) {
        await generateForMeditation(m.slug, options)
      }
    }
  } else if (slugArg) {
    await generateForMeditation(slugArg, options)
  }

  console.log('\nDone!')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
