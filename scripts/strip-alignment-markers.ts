/**
 * strip-alignment-markers.ts <alignment.json>...  (audit 10/11/2026 W5)
 *
 * Some EN sleep meditations were rendered before Phase C and their final alignment still carries a
 * `[BREATHING_SECTION]` label line. It has zero duration (start === end: nothing is spoken there), but the player shows it
 * in the transcript and QA fails on it ("no BREATHING_SECTION markers in final alignment").
 *
 * This removes ONLY such zero-length marker lines, with their timestamps. The audio is not touched, so no TTS credits are
 * spent. A marker that has a duration, or a malformed alignment, is refused and the file left byte-identical: those need
 * a real regeneration (`pipeline.ts ship <slug>`), not a cleanup. Idempotent; writes atomically.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

interface Alignment { lines: string[]; timestamps: { start: number; end: number }[]; duration: number }

const MARKER = /^\s*\[BREATHING_SECTION\]\s*$/

function clean(file: string): number {
  const raw = readFileSync(file, 'utf-8')
  const a = JSON.parse(raw) as Alignment
  if (!Array.isArray(a.lines) || !Array.isArray(a.timestamps) || a.lines.length !== a.timestamps.length) {
    throw new Error(`${file}: lines/timestamps missing or of different lengths`)
  }
  const drop = new Set<number>()
  a.lines.forEach((l, i) => {
    if (!MARKER.test(l)) return
    const t = a.timestamps[i]
    if (!t || t.end !== t.start) throw new Error(`${file}: marker at line ${i} has a duration — regenerate, do not strip`)
    drop.add(i)
  })
  if (drop.size === 0) return 0
  const out: Alignment = {
    ...a,
    lines: a.lines.filter((_, i) => !drop.has(i)),
    timestamps: a.timestamps.filter((_, i) => !drop.has(i)),
  }
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(out, null, raw.includes('\n  ') ? 2 : undefined))
  renameSync(tmp, file)
  return drop.size
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: tsx scripts/strip-alignment-markers.ts <alignment.json>...')
  process.exit(2)
}
let failed = false
for (const f of files) {
  try {
    console.log(`${f}: ${clean(f)} marker line(s) removed`)
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
