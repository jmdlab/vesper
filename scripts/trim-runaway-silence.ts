/**
 * Zero-credit repair: shrink every silence the script does not ask for back to TRIM_KEEP_S seconds, and shift the
 * alignment to match. Speech is never cut: only audio inside a detected silence (< -50 dB) is removed, by stream copy.
 *
 * Audit 10/11/2026 round 5: ElevenLabs v3 turned [long pause] chains into 2–13.6 min of dead air in 22 shipped files.
 * This removes the dead air. If the render ALSO dropped speech, that speech is still missing: regenerate (paid) later.
 *
 * Usage:
 *   npx tsx scripts/trim-runaway-silence.ts <lang> <slug> --backup-dir=<dir> [--dry-run] [--audio-dir=<dir>] [--noise-db=-50]
 *     lang: en | en-v2 | fr. The original mp3+json are copied to <backup-dir>/<lang>/ first (never overwritten).
 * Idempotent: a file with no runaway silence is left byte-identical (exit 0, "nothing to trim").
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { validateMeditation } from './lib/validate-meditation.js'
import { prepareScript } from './prepare-tts.js'
import {
  detectSilences, runawaySilences, longestRequestedPause, trimCuts, shiftAlignment, probeDuration,
  type Alignment, type Span,
} from './lib/silence-guard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const flag = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const [lang, slug] = args.filter(a => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')
const backupDir = flag('backup-dir')
const audioDir = flag('audio-dir') ?? join(PROJECT_ROOT, 'audio-storage')
const contentDir = flag('content-dir') ?? join(PROJECT_ROOT, 'src', 'content', 'meditations')

function die(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!lang || !slug || !['en', 'en-v2', 'fr'].includes(lang)) die('usage: trim-runaway-silence.ts <en|en-v2|fr> <slug> --backup-dir=<dir> [--dry-run]')
if (!dryRun && !backupDir) die('--backup-dir is required (the original audio is not in git)')

const mp3 = join(audioDir, lang, `${slug}.mp3`)
const jsonPath = join(audioDir, lang, `${slug}.json`)
if (!existsSync(mp3) || !existsSync(jsonPath)) die(`missing ${mp3} or its alignment`)

const med = validateMeditation(slug, JSON.parse(readFileSync(join(contentDir, `${slug}.json`), 'utf-8')))
const script = lang === 'fr' ? med.scriptFr : med.scriptEn
const requested = longestRequestedPause(prepareScript(script, med.category, med.breathing != null))
const duration = probeDuration(mp3)
// --noise-db=-45 for a file whose dead air carries faint blips above -50 dB (en/morning-armor-of-god, 10/11): check the cuts in --dry-run first.
const noiseDb = Number(flag('noise-db') ?? -50)
if (!Number.isFinite(noiseDb) || noiseDb > -40 || noiseDb < -70) die('--noise-db must be between -70 and -40')
const runaway = runawaySilences(detectSilences(mp3, 30, noiseDb), requested)
const cuts = trimCuts(runaway)

if (cuts.length === 0) {
  console.log(`✓ ${lang}/${slug}: nothing to trim (script asks ≤${requested}s)`)
  process.exit(0)
}
const removed = cuts.reduce((s, c) => s + (c.end - c.start), 0)
console.log(`${lang}/${slug}: ${cuts.length} runaway silence(s), removing ${removed.toFixed(1)}s of ${duration.toFixed(1)}s ` +
  `(script asks ≤${requested}s): ${runaway.map(r => `${r.start.toFixed(1)}–${r.end.toFixed(1)}`).join(', ')}`)
if (dryRun) process.exit(0)

const alignment: Alignment = JSON.parse(readFileSync(jsonPath, 'utf-8'))
if (alignment.lines.length !== alignment.timestamps.length) die('alignment lines/timestamps length mismatch — refusing')

// 1. Backup, never overwriting an earlier (more original) backup.
const bdir = join(backupDir!, lang)
mkdirSync(bdir, { recursive: true })
for (const [src, name] of [[mp3, `${slug}.mp3`], [jsonPath, `${slug}.json`]] as const) {
  const dest = join(bdir, name)
  if (!existsSync(dest)) copyFileSync(src, dest)
}

// 2. Keep-spans = complement of the cuts. Stream copy (no re-encode): the cut points sit inside silence, so the
//    ±1 frame (26 ms) precision of a copy cut is inaudible.
const keeps: Span[] = []
let cursor = 0
for (const c of cuts) {
  keeps.push({ start: cursor, end: c.start })
  cursor = c.end
}
keeps.push({ start: cursor, end: duration })

const tmpDir = join(audioDir, lang, `_trim_${slug}_${process.pid}`)
mkdirSync(tmpDir, { recursive: true })
const partFiles: string[] = []
try {
  keeps.forEach((k, i) => {
    const part = join(tmpDir, `part${i}.mp3`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', k.start.toFixed(3), '-to', k.end.toFixed(3),
      '-i', mp3, '-c', 'copy', '-map_metadata', '-1', part])
    partFiles.push(part)
  })
  const list = join(tmpDir, 'list.txt')
  writeFileSync(list, partFiles.map(f => `file '${f}'`).join('\n') + '\n')
  const outTmp = join(tmpDir, 'out.mp3')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', outTmp])

  const newDur = probeDuration(outTmp)
  const expected = duration - removed
  if (Math.abs(newDur - expected) > 1.0) die(`trimmed length ${newDur.toFixed(2)}s, expected ${expected.toFixed(2)}s — original kept`)

  const shifted = shiftAlignment(alignment, cuts)
  shifted.duration = Math.round(newDur * 1000) / 1000
  const jsonTmp = join(tmpDir, 'out.json')
  writeFileSync(jsonTmp, JSON.stringify(shifted, null, 2) + '\n')

  renameSync(outTmp, mp3)
  renameSync(jsonTmp, jsonPath)
  console.log(`✓ ${lang}/${slug}: ${duration.toFixed(1)}s → ${newDur.toFixed(1)}s; backup in ${bdir}`)
} finally {
  for (const f of [...partFiles, join(tmpDir, 'list.txt'), join(tmpDir, 'out.mp3'), join(tmpDir, 'out.json')]) {
    try { unlinkSync(f) } catch {}
  }
  try { execFileSync('rmdir', [tmpDir]) } catch {}
}
