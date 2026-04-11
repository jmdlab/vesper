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

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { prepareScript, chunkText, getVoiceSettings } from './prepare-tts.js'
import { validateMeditation } from './lib/validate-meditation.js'
import { retry } from './lib/retry.js'
import { buildBreathingChunk } from './lib/breathing-audio.js'

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

/** Load a meditation JSON from the content directory with runtime validation */
function loadMeditation(slug: string): MeditationJSON | null {
  const filePath = join(CONTENT_DIR, `${slug}.json`)
  if (!existsSync(filePath)) return null
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  return validateMeditation(slug, raw) as unknown as MeditationJSON
}

/** Load all meditation JSONs with runtime validation */
function loadAllMeditations(): MeditationJSON[] {
  const files = readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'))
  return files.map(f => {
    const slug = f.replace('.json', '')
    const raw = JSON.parse(readFileSync(join(CONTENT_DIR, f), 'utf-8'))
    return validateMeditation(slug, raw) as unknown as MeditationJSON
  })
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

    // Phase C: split prepared text on [BREATHING_SECTION] markers. The script
    // becomes an alternating sequence of text segments and breathing positions.
    // Each text segment is TTS-generated independently; each breathing position
    // is rendered from the clip bank via buildBreathingChunk. Then we
    // concatenate in order. No post-hoc splicing, no silencedetect, no stale
    // snapshot contamination — breathing position is authoritative from the
    // source script.
    const MARKER_RE = /\n\s*\[BREATHING_SECTION\]\s*\n/
    const textSegments = prepared.split(MARKER_RE)
    const breathingCount = textSegments.length - 1

    if (options.dryRun) {
      console.log(`\n--- DRY RUN: ${slug} (${l}) [${meditation.category}] ---`)
      console.log(`Prepared text (${prepared.length} chars):`)
      console.log(`  ${textSegments.length} text segment(s), ${breathingCount} breathing block(s)`)
      console.log(prepared.slice(0, 500))
      if (prepared.length > 500) console.log(`... (${prepared.length - 500} more chars)`)
      console.log('---')
      continue
    }

    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

    console.log(`\n  Generating ${slug} (${l}) [${meditation.category}]...`)
    console.log(`    ${textSegments.length} text segment(s), ${breathingCount} breathing block(s), ${prepared.length} chars`)

    // Interleaved rendering: [text] [breath] [text] [breath] ... [text]
    // Each piece produces: { audio: Buffer, lines: string[], timestamps: [{start,end}] }
    // with timestamps RELATIVE to the piece's start (0). We'll apply a cumulative
    // offset when assembling the final alignment.
    interface RenderedPiece {
      audio: Buffer
      lines: string[]
      timestamps: Array<{ start: number; end: number }>
      duration: number  // actual mp3 duration via ffprobe
      kind: 'text' | 'breathing'
    }

    const pieces: RenderedPiece[] = []
    const ffprobeDur = (buf: Buffer): number => {
      const tmp = join(outDir, `_piece_tmp_${process.pid}.mp3`)
      writeFileSync(tmp, buf)
      try {
        return parseFloat(
          execFileSync('ffprobe', [
            '-v', 'quiet', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', tmp,
          ], { encoding: 'utf-8' }).trim()
        )
      } finally {
        try { unlinkSync(tmp) } catch {}
      }
    }

    // Render a single text segment: chunk if too long, call TTS per chunk,
    // merge alignments with cumulative offset within the segment, return a
    // single RenderedPiece covering the whole segment.
    const renderTextSegment = async (segIdx: number, segmentText: string): Promise<RenderedPiece | null> => {
      const trimmedCheck = segmentText.replace(/\[.*?\]/g, '').trim()
      if (!trimmedCheck) {
        console.log(`    Text segment ${segIdx + 1} — skipped (empty after preparation)`)
        return null
      }
      const chunks = chunkText(segmentText)
      console.log(`    Text segment ${segIdx + 1}/${textSegments.length}: ${chunks.length} chunk(s), ${segmentText.length} chars`)

      const segBuffers: Buffer[] = []
      const segAlignments: TTSResult['alignment'][] = []
      let innerOffset = 0

      for (let i = 0; i < chunks.length; i++) {
        const trimmed = chunks[i].replace(/\[.*?\]/g, '').trim()
        if (!trimmed) {
          console.log(`      Chunk ${i + 1}/${chunks.length} — skipped (empty)`)
          continue
        }
        console.log(`      Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`)
        const { audio, alignment } = await retry(
          () => callTTS(chunks[i], voiceId, voiceSettings),
          {
            maxAttempts: 4,
            onRetry: (attempt, err, waitMs) => {
              console.warn(`        retry ${attempt} in ${(waitMs/1000).toFixed(1)}s — ${(err as Error).message.slice(0, 80)}`)
            },
          },
        )
        segBuffers.push(audio)

        // Offset per-character alignment to account for earlier chunks
        if (alignment && innerOffset > 0) {
          alignment.character_start_times_seconds = alignment.character_start_times_seconds.map(t => t + innerOffset)
          alignment.character_end_times_seconds = alignment.character_end_times_seconds.map(t => t + innerOffset)
        }
        if (alignment) {
          innerOffset += ffprobeDur(audio)
        }
        segAlignments.push(alignment)

        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200))
      }

      // Combine segment chunks → one buffer
      const segCombined = Buffer.concat(segBuffers)
      const segDuration = innerOffset  // cumulative audio duration after all chunks

      // Merge chunk alignments (all characters concatenated)
      const merged = {
        characters: segAlignments.flatMap(a => a?.characters ?? []),
        character_start_times_seconds: segAlignments.flatMap(a => a?.character_start_times_seconds ?? []),
        character_end_times_seconds: segAlignments.flatMap(a => a?.character_end_times_seconds ?? []),
      }

      // Convert character timestamps → line-level timestamps for this segment
      const segPreparedLines = segmentText.split('\n').filter(l => l.trim().length > 0)
      const segLineTs: Array<{ start: number; end: number }> = []

      // Group char indices by newline boundaries
      const charGroups: number[][] = []
      let currentGroup: number[] = []
      for (let ci = 0; ci < merged.characters.length; ci++) {
        if (merged.characters[ci] === '\n') {
          if (currentGroup.length > 0) charGroups.push(currentGroup)
          currentGroup = []
        } else {
          currentGroup.push(ci)
        }
      }
      if (currentGroup.length > 0) charGroups.push(currentGroup)

      const nonEmptyGroups = charGroups.filter(group =>
        group.some(ci => merged.characters[ci]?.trim() !== '')
      )

      for (let li = 0; li < segPreparedLines.length; li++) {
        if (li < nonEmptyGroups.length) {
          const group = nonEmptyGroups[li]
          const starts = group
            .map(ci => merged.character_start_times_seconds[ci])
            .filter((t): t is number => t !== undefined && t > 0)
          const ends = group
            .map(ci => merged.character_end_times_seconds[ci])
            .filter((t): t is number => t !== undefined && t > 0)
          const start = starts.length > 0 ? Math.min(...starts) : (segLineTs.length > 0 ? segLineTs[segLineTs.length - 1].end : 0)
          const end = ends.length > 0 ? Math.max(...ends) : start
          segLineTs.push({ start, end })
        } else {
          const prev = segLineTs.length > 0 ? segLineTs[segLineTs.length - 1].end : 0
          segLineTs.push({ start: prev, end: prev })
        }
      }

      return {
        audio: segCombined,
        lines: segPreparedLines,
        timestamps: segLineTs,
        duration: segDuration,
        kind: 'text',
      }
    }

    // Render breathing as a chunk (clip-bank audio + synthetic alignment)
    const renderBreathingChunk = (breathIdx: number): RenderedPiece | null => {
      if (!hasBreathing) {
        console.warn(`    Breathing ${breathIdx + 1} skipped — meditation has no breathing config`)
        return null
      }
      console.log(`    Breathing block ${breathIdx + 1}/${breathingCount}...`)
      const brConfig = (meditation as unknown as { breathing: { inhale: number; holdIn: number; exhale: number; holdOut: number; rounds: number } }).breathing
      const chunk = buildBreathingChunk(slug, l, brConfig)
      const breathBuf = readFileSync(chunk.mp3Path)
      const actualDur = ffprobeDur(breathBuf)
      return {
        audio: breathBuf,
        lines: chunk.lines.map(c => c.text),
        timestamps: chunk.lines.map(c => ({ start: c.start, end: c.end })),
        duration: actualDur,
        kind: 'breathing',
      }
    }

    // Interleave: text[0], breath[0], text[1], breath[1], ..., text[N]
    for (let i = 0; i < textSegments.length; i++) {
      const textPiece = await renderTextSegment(i, textSegments[i])
      if (textPiece) pieces.push(textPiece)
      if (i < breathingCount) {
        const breathPiece = renderBreathingChunk(i)
        if (breathPiece) pieces.push(breathPiece)
      }
    }

    // Assemble final audio + alignment with cumulative offset
    const buffers: Buffer[] = pieces.map(p => p.audio)
    const finalLines: string[] = []
    const finalTimestamps: Array<{ start: number; end: number }> = []
    let cumOffset = 0
    for (const piece of pieces) {
      for (let i = 0; i < piece.lines.length; i++) {
        finalLines.push(piece.lines[i])
        finalTimestamps.push({
          start: Math.round((piece.timestamps[i].start + cumOffset) * 1000) / 1000,
          end: Math.round((piece.timestamps[i].end + cumOffset) * 1000) / 1000,
        })
      }
      cumOffset += piece.duration
    }
    const chunkTimeOffset = cumOffset  // final audio duration, used in alignment write below

    // Write audio — raw concat of interleaved TTS + breathing mp3s
    const combined = Buffer.concat(buffers)
    writeFileSync(outPath, combined)

    // Post-write drift check: verify the concatenated mp3's ffprobe duration
    // matches our accumulated `chunkTimeOffset`. Drift >250ms suggests MP3
    // frame-boundary issues or a count mismatch in the interleave logic.
    try {
      const actualDur = parseFloat(
        execFileSync('ffprobe', [
          '-v', 'quiet', '-show_entries', 'format=duration',
          '-of', 'csv=p=0', outPath,
        ], { encoding: 'utf-8' }).trim()
      )
      const drift = Math.abs(actualDur - chunkTimeOffset)
      if (drift > 0.25) {
        console.warn(`    ⚠ duration drift: computed ${chunkTimeOffset.toFixed(2)}s vs ffprobe ${actualDur.toFixed(2)}s (|Δ|=${drift.toFixed(2)}s)`)
      }
    } catch { /* ignore — duration check is informational */ }

    // Invalidate stale insert-breathing snapshots (legacy safety — the new
    // generate-tts flow doesn't create them, but older runs may have left some)
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

    // Write alignment JSON alongside the audio.
    // With the interleaved text+breathing pipeline (Phase C), `finalLines`
    // includes both spoken TTS lines AND breathing caption lines at correct
    // cumulative offsets — the alignment is authoritative at generation time,
    // no post-hoc splicing needed.
    const alignPath = join(outDir, `${slug}.json`)
    writeFileSync(alignPath, JSON.stringify({
      lines: finalLines,
      timestamps: finalTimestamps,
      duration: chunkTimeOffset,
    }, null, 2) + '\n')

    // Update the meditation JSON with the audio path
    const audioWebPath = `/audio/${l}/${slug}.mp3`
    updateAudioPath(slug, l, audioWebPath)

    // NOTE: audio-storage/ is the canonical source. pipeline.ts `ship` copies
    // to public/audio/ as its final step, and handleDeploy rsyncs the final
    // shipping tree from audio-storage/ → /var/www/vesper-static/audio/.
    // Removing the eager copy here fixes the two-sources-of-truth drift.

    const sizeMB = (statSync(outPath).size / 1024 / 1024).toFixed(1)
    console.log(`    Done: ${outPath} (${sizeMB} MB)`)
    console.log(`    Alignment: ${alignPath} (${finalTimestamps.length} lines, ${chunkTimeOffset.toFixed(1)}s)`)
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
