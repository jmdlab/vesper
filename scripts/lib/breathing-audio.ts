/**
 * Build clip-based breathing audio from the prerecorded voice clip bank.
 *
 * Extracted from insert-breathing.ts to make breathing a first-class "chunk"
 * during TTS generation instead of a post-hoc splice. This eliminates the
 * silence-detection heuristic and the entire class of bugs around stale
 * marker indices, collapsed timestamps, and snapshot contamination.
 *
 * Modularity note: this module knows NOTHING about meditation scripts or
 * alignments. It only knows how to turn a (breathing config, lang) into an
 * mp3 file on disk. Callers own the concatenation and alignment.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const AUDIO_DIR = join(PROJECT_ROOT, 'audio-storage')

// Timing constants — kept in sync with reconstruct-breathing.py
export const INTER_PHASE_GAP = 0.5   // silence between phases within a round
export const INTER_ROUND_GAP = 2.0   // longer breath between rounds

export interface BreathingConfig {
  inhale: number
  holdIn: number
  exhale: number
  holdOut: number
  rounds: number
}

/**
 * Localized captions that match the spoken breathing clips. These MUST match
 * the audio content of the corresponding clips in audio-storage/clips/{lang}/
 * — changing the words here won't change the audio, so keep them in sync with
 * the clip bank recordings. Order: [first, again, middle, last].
 */
const INSTR_LABELS_BY_LANG: Record<string, Record<string, string[]>> = {
  en: {
    inhale:   ['Breathe in through your nose for four.', 'Again. In for four.',    'In for four.',  'One more. In for four.'],
    hold_in:  ['Hold gently for four.',                   'Hold for four.',           'Hold for four.', 'Hold for four.'],
    exhale:   ['Exhale slowly through your mouth.',       'Out for four.',            'Out for four.',  'Out for four.'],
    hold_out: ['And hold for four.',                      'Hold for four.',           'Hold for four.', 'Hold for four.'],
  },
  fr: {
    inhale:   ['Inspirez par le nez, quatre temps.',      'Encore. Inspirez sur quatre.', 'Inspirez sur quatre.', 'Une dernière fois. Inspirez sur quatre.'],
    hold_in:  ['Retenez doucement sur quatre.',           'Retenez sur quatre.',           'Retenez sur quatre.',  'Retenez sur quatre.'],
    exhale:   ['Expirez par la bouche, quatre temps.',    'Expirez sur quatre.',           'Expirez sur quatre.',  'Expirez sur quatre.'],
    hold_out: ['Et retenez sur quatre.',                  'Retenez sur quatre.',           'Retenez sur quatre.',  'Retenez sur quatre.'],
  },
}
INSTR_LABELS_BY_LANG['en-v2'] = INSTR_LABELS_BY_LANG.en

/** Clip file mapping per phase type. */
const CLIP_MAP: Record<string, Record<string, string>> = {
  inhale:   { first: 'breathe-in-long', again: 'again-in', middle: 'in',   last: 'one-more-in' },
  hold_in:  { first: 'hold-gently',     again: 'hold',     middle: 'hold', last: 'hold' },
  exhale:   { first: 'breathe-out-long', again: 'out',     middle: 'out',  last: 'out' },
  hold_out: { first: 'hold-bottom',     again: 'hold',     middle: 'hold', last: 'hold' },
}

export interface BreathingChunk {
  /** Absolute path to the rendered mp3 */
  mp3Path: string
  /** Total duration in seconds (matches ffprobe on mp3Path) */
  duration: number
  /** Per-phase caption lines (language-localized) with relative timestamps */
  lines: Array<{ text: string; start: number; end: number }>
}

/**
 * Render a breathing block as a standalone mp3 + synthetic alignment.
 *
 * Returns {mp3Path, duration, lines} where `lines` is the caption sequence
 * with timestamps RELATIVE TO THE START OF THE BREATHING AUDIO (the caller
 * adds its concat offset). Throws on missing clips or bad config.
 */
export function buildBreathingChunk(
  slug: string,
  lang: string,
  breathing: BreathingConfig,
  tmpDirOverride?: string,
): BreathingChunk {
  const { inhale, holdIn, exhale, holdOut, rounds } = breathing

  // Resolve clip bank + caption labels
  const voiceName = lang === 'fr' ? 'koraly' : 'katherine'
  const clipsDir = join(AUDIO_DIR, 'clips', lang === 'fr' ? 'fr' : 'en', voiceName)
  const instrDir = join(clipsDir, 'instructions')
  if (!existsSync(instrDir)) {
    throw new Error(`Clip bank not found: ${instrDir}`)
  }
  const labels = INSTR_LABELS_BY_LANG[lang] ?? INSTR_LABELS_BY_LANG.en

  // Build phase list (skip zero-duration phases)
  const phases: Array<[string, number]> = []
  if (inhale > 0)  phases.push(['inhale',   inhale])
  if (holdIn > 0)  phases.push(['hold_in',  holdIn])
  if (exhale > 0)  phases.push(['exhale',   exhale])
  if (holdOut > 0) phases.push(['hold_out', holdOut])

  if (phases.length === 0 || rounds < 1) {
    throw new Error(`Invalid breathing config: phases=${phases.length}, rounds=${rounds}`)
  }

  // Per-slug temp dir so concurrent ships don't clobber each other
  const tmpDir = tmpDirOverride ?? join(AUDIO_DIR, lang, `_tmp_breathing_${slug}_${process.pid}`)
  mkdirSync(tmpDir, { recursive: true })

  // Silence gap clips
  const silencePhase = join(tmpDir, 'gap_phase.wav')
  const silenceRound = join(tmpDir, 'gap_round.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i',
    `anullsrc=r=44100:cl=mono:d=${INTER_PHASE_GAP}`,
    '-t', String(INTER_PHASE_GAP), silencePhase], { stdio: 'pipe' })
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i',
    `anullsrc=r=44100:cl=mono:d=${INTER_ROUND_GAP}`,
    '-t', String(INTER_ROUND_GAP), silenceRound], { stdio: 'pipe' })

  // Build sequence of rendered phase wavs + caption lines
  const phaseFiles: string[] = []
  const lines: BreathingChunk['lines'] = []
  let cursor = 0

  for (let r = 1; r <= rounds; r++) {
    for (let p = 0; p < phases.length; p++) {
      const [type, dur] = phases[p]
      const variants = CLIP_MAP[type] ?? CLIP_MAP.inhale

      // Variant selection (matches old logic + rounds==2 order fix)
      let baseName: string
      if (r === 1) baseName = variants.first
      else if (r === rounds && type === 'inhale') baseName = variants.last
      else if (r === 2 && type === 'inhale') baseName = variants.again
      else baseName = variants.middle

      // Count-specific clip (e.g. hold-4.mp3) falls back to default (hold.mp3)
      const countSpecific = join(instrDir, `${baseName}-${dur}.mp3`)
      const fallback = join(instrDir, `${baseName}.mp3`)
      const clipPath = existsSync(countSpecific) ? countSpecific : fallback
      if (!existsSync(clipPath)) {
        throw new Error(`Missing clip: ${clipPath}`)
      }

      // Render phase: clip padded with silence to exact `dur` seconds
      const phaseWav = join(tmpDir, `phase_${r}_${p}.wav`)
      execFileSync('ffmpeg', [
        '-y', '-i', clipPath,
        '-af', `apad=whole_dur=${dur}`,
        '-t', String(dur),
        '-ar', '44100', '-ac', '1', phaseWav,
      ], { stdio: 'pipe' })
      phaseFiles.push(phaseWav)

      // Caption: pick label variant matching clip variant
      const labelArr = labels[type] ?? ['...']
      let label: string
      if (r === 1) label = labelArr[0]
      else if (r === rounds && type === 'inhale') label = labelArr[Math.min(3, labelArr.length - 1)]
      else if (r === 2 && type === 'inhale') label = labelArr[Math.min(1, labelArr.length - 1)]
      else label = labelArr[Math.min(2, labelArr.length - 1)]

      lines.push({
        text: label,
        start: Math.round(cursor * 1000) / 1000,
        end: Math.round((cursor + dur) * 1000) / 1000,
      })
      cursor += dur

      // Insert the gap audio (but the caption for the previous phase ends at `cursor` before the gap)
      if (p < phases.length - 1) {
        phaseFiles.push(silencePhase)
        cursor += INTER_PHASE_GAP
      } else if (r < rounds) {
        phaseFiles.push(silenceRound)
        cursor += INTER_ROUND_GAP
      }
    }
  }

  // Concat all phase wavs → single mp3
  const concatList = join(tmpDir, 'concat.txt')
  writeFileSync(concatList, phaseFiles.map(f => `file '${f}'`).join('\n'))

  const breathingMp3 = join(tmpDir, 'breathing.mp3')
  execFileSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatList, '-q:a', '2', '-ar', '44100', breathingMp3,
  ], { stdio: 'pipe' })

  return {
    mp3Path: breathingMp3,
    duration: Math.round(cursor * 1000) / 1000,
    lines,
  }
}
