/**
 * Silence guard — the rules that keep runaway silences and wrong listed durations out of shipped audio.
 *
 * Why (audit 10/11/2026 round 5): ElevenLabs v3 sometimes renders a chain of `[long pause]` tags as many minutes of
 * silence, often dropping the speech that follows. 22 shipped files held 2–13.6 min of silence where the script asked
 * for at most ~45 s. Nothing caught it: QA only warned on collapsed alignment and never measured the audio itself.
 *
 * Used by: generate-tts.ts (reject a chunk → retry), qa-meditations.ts (fail the deploy gate),
 * trim-runaway-silence.ts (zero-credit repair of an already-shipped file).
 */

import { execFileSync, spawnSync } from 'child_process'
import { writeFileSync, unlinkSync, readFileSync, statSync, renameSync } from 'fs'

export interface Span { start: number; end: number }
export interface Alignment { lines: string[]; timestamps: Span[]; duration: number }

/** ElevenLabs v3 renders one `[long pause]` as ~3 s and one `[short pause]` as ~1 s (prepare-tts.ts:244). */
export const SECONDS_PER_LONG_PAUSE = 3
export const SECONDS_PER_SHORT_PAUSE = 1
/** Below this no silence is ever flagged: healthy shipped files peak at ~21 s. */
export const SILENCE_FLOOR_S = 60
/** Listed `durationMin` vs real audio. */
export const DURATION_TOLERANCE = 0.15
/** What a runaway silence is cut back to by trim-runaway-silence.ts: longer than any paragraph pause (≤ 6 s). */
export const TRIM_KEEP_S = 8

const PAUSE_TAG_RE = /\[(long|short) pause\]/gi

/** Seconds of pause a piece of prepared text asks for (sum of its pause tags). */
export function requestedPauseSeconds(text: string): number {
  let s = 0
  for (const m of text.matchAll(PAUSE_TAG_RE)) {
    s += m[1].toLowerCase() === 'long' ? SECONDS_PER_LONG_PAUSE : SECONDS_PER_SHORT_PAUSE
  }
  return s
}

/**
 * Longest pause the prepared script asks for in one place: the largest run of pause tags with no spoken word
 * between them (across line breaks). A breathing marker ends a run (breathing audio is clip-built, not TTS).
 */
export function longestRequestedPause(prepared: string): number {
  const tokens = prepared.split(/(\[[^\]]*\])/)
  let best = 0
  let run = 0
  for (const tok of tokens) {
    if (/^\[(long|short) pause\]$/i.test(tok)) {
      run += requestedPauseSeconds(tok)
      best = Math.max(best, run)
    } else if (tok.trim() !== '' || /^\[/.test(tok)) {
      run = 0
    }
  }
  return best
}

/** Longest silence allowed in audio whose script asks for at most `requested` seconds of pause in one place. */
export function allowedSilenceSeconds(requested: number): number {
  return Math.max(SILENCE_FLOOR_S, requested * 1.5 + 15)
}

/** Silences that exceed what the script allows. */
export function runawaySilences(silences: Span[], requested: number): Span[] {
  const allowed = allowedSilenceSeconds(requested)
  return silences.filter(s => s.end - s.start > allowed)
}

/** Silences ≥ minSeconds below `noiseDb` (ffmpeg silencedetect). A silence that runs to the end is closed at `duration`. */
export function detectSilences(mp3Path: string, minSeconds = 20, noiseDb = -50): Span[] {
  // silencedetect reports on stderr
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-nostats', '-i', mp3Path,
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minSeconds}`, '-f', 'null', '-',
  ], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`ffmpeg silencedetect failed on ${mp3Path}: ${(r.stderr ?? '').slice(-200)}`)
  return parseSilences(r.stderr, probeDuration(mp3Path))
}

export function parseSilences(ffmpegStderr: string, duration: number): Span[] {
  const starts = [...ffmpegStderr.matchAll(/silence_start: (-?[\d.]+)/g)].map(m => Math.max(0, parseFloat(m[1])))
  const ends = [...ffmpegStderr.matchAll(/silence_end: ([\d.]+)/g)].map(m => parseFloat(m[1]))
  return starts.map((start, i) => ({ start, end: ends[i] ?? duration }))
}

export function probeDuration(mp3Path: string): number {
  return parseFloat(execFileSync('ffprobe', [
    '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3Path,
  ], { encoding: 'utf-8' }).trim())
}

/** true when the listed minutes are within ±15 % of the real audio length. */
export function durationMatches(listedMin: number, realSeconds: number): boolean {
  if (!(listedMin > 0) || !(realSeconds > 0)) return false
  return Math.abs(realSeconds / 60 - listedMin) / listedMin <= DURATION_TOLERANCE
}

/** Listed minutes for a real length (what durationMin should say). */
export function listedMinutesFor(realSeconds: number): number {
  return Math.max(1, Math.round(realSeconds / 60))
}

/**
 * Cuts that shrink each runaway silence to `keep` seconds, centred on the silence (half the kept pause on each side,
 * so the speech before and after keeps its natural tail and lead-in).
 */
export function trimCuts(runaway: Span[], keep = TRIM_KEEP_S): Span[] {
  return runaway
    .filter(s => s.end - s.start > keep)
    .map(s => ({ start: s.start + keep / 2, end: s.end - keep / 2 }))
    .sort((a, b) => a.start - b.start)
}

/** Map a time in the original audio to the trimmed audio. Times inside a cut land on the cut point. */
export function mapTime(t: number, cuts: Span[]): number {
  let removed = 0
  for (const c of cuts) {
    if (t >= c.end) removed += c.end - c.start
    else if (t > c.start) return round3(c.start - removed)
    else break
  }
  return round3(t - removed)
}

/** Alignment for the trimmed audio: every timestamp mapped, lines untouched, duration reduced by the cuts. */
export function shiftAlignment(al: Alignment, cuts: Span[]): Alignment {
  const removed = cuts.reduce((s, c) => s + (c.end - c.start), 0)
  return {
    ...al,
    lines: [...al.lines],
    timestamps: al.timestamps.map(t => ({ start: mapTime(t.start, cuts), end: mapTime(t.end, cuts) })),
    duration: round3(al.duration - removed),
  }
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}

/** Marker in the error message so lib/retry.ts treats a runaway-silence chunk as retryable (a fresh render). */
export const RUNAWAY_SILENCE = 'RUNAWAY_SILENCE'

/**
 * Throws a retryable error when a freshly rendered TTS chunk holds a silence its own text does not ask for.
 * Called inside the retry() of every chunk in generate-tts.ts, so a bad render is re-requested instead of shipped.
 */
export function assertChunkHasNoRunawaySilence(audio: Buffer, chunkText: string, tmpPath: string): void {
  writeFileSync(tmpPath, audio)
  try {
    const requested = longestRequestedPause(chunkText)
    const runaway = runawaySilences(detectSilences(tmpPath, 30), requested)
    if (runaway.length > 0) {
      const r = runaway[0]
      throw new Error(`${RUNAWAY_SILENCE}: ${(r.end - r.start).toFixed(0)}s silence at ${r.start.toFixed(0)}s, ` +
        `chunk asks ≤${requested}s (allowed ${allowedSilenceSeconds(requested).toFixed(0)}s)`)
    }
  } finally {
    try { unlinkSync(tmpPath) } catch {}
  }
}

/**
 * detectSilences with an on-disk cache keyed by path + size + mtime, so the QA gate decodes only audio that changed
 * (a full decode of every file takes minutes). The cache sits at the audio root, outside the per-language folders
 * that deploy copies.
 */
export function detectSilencesCached(mp3Path: string, minSeconds: number, cacheFile: string): Span[] {
  let cache: Record<string, { key: string; silences: Span[] }> = {}
  try { cache = JSON.parse(readFileSync(cacheFile, 'utf-8')) } catch {}
  const st = statSync(mp3Path)
  const key = `${st.size}:${st.mtimeMs}:${minSeconds}`
  const hit = cache[mp3Path]
  if (hit && hit.key === key) return hit.silences
  const silences = detectSilences(mp3Path, minSeconds)
  // re-read just before writing: tolerate another process having written meanwhile
  try { cache = JSON.parse(readFileSync(cacheFile, 'utf-8')) } catch {}
  cache[mp3Path] = { key, silences }
  const tmp = `${cacheFile}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(cache))
  renameSync(tmp, cacheFile)
  return silences
}
