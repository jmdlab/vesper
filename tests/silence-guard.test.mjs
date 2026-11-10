// Runaway silences + wrong listed durations (audit 10/11/2026 round 5). ElevenLabs v3 turned [long pause] chains into
// 2–13.6 min of dead air in 22 shipped files and nothing caught it. This pins: the rule (scripts/lib/silence-guard.ts),
// the generator re-rendering such a chunk (lib/retry.ts), the QA gate failing on it and on a listed duration > 15 % off,
// and the zero-credit trim repair (scripts/trim-runaway-silence.ts).      npx tsx tests/silence-guard.test.mjs
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const g = await import(join(root, 'scripts/lib/silence-guard.ts'))
const { retry } = await import(join(root, 'scripts/lib/retry.ts'))

// 1. what the script asks for
assert.equal(g.requestedPauseSeconds('[long pause] [long pause] [short pause]'), 7)
assert.equal(g.longestRequestedPause('Hi.\n[long pause] [long pause]\n[long pause]\nThere. [short pause]'), 9)
assert.equal(g.longestRequestedPause('A [long pause]\n[BREATHING_SECTION]\n[long pause] B'), 3, 'a breathing marker ends a pause run')
assert.equal(g.allowedSilenceSeconds(6), 60, 'floor')
assert.equal(g.allowedSilenceSeconds(45), 82.5, 'a scripted [90s pause] (×0.5) stays allowed')
assert.deepEqual(g.runawaySilences([{ start: 0, end: 70 }], 45), [], 'scripted long pause is not runaway')
assert.equal(g.runawaySilences([{ start: 125, end: 935 }], 45).length, 1, 'a 13.5 min silence is runaway')
console.log('ok pause rule')

// 2. duration tolerance
assert.ok(g.durationMatches(9, 9 * 60 * 1.14))
assert.ok(!g.durationMatches(9, 30.7 * 60), 'isaiah-renew: listed 9, real 30.7 min')
assert.ok(!g.durationMatches(32, 23.2 * 60), 'sleep-forgiveness: listed 32, real 23.2 min')
assert.equal(g.listedMinutesFor(23.2 * 60), 23)
assert.ok(g.durationMatches(1, 0.4 * 60), 'a 25 s prayer listed as 1 min: the card cannot say less')
assert.ok(g.durationMatches(2, 2.3 * 60), 'nearest whole minute is always accepted')
assert.ok(!g.durationMatches(3, 2.3 * 60), 'but not a different minute')
console.log('ok duration rule')

// 3. alignment shift
const cuts = g.trimCuts([{ start: 20, end: 120 }], 8)
assert.deepEqual(cuts, [{ start: 24, end: 116 }])
assert.equal(g.mapTime(10, cuts), 10)
assert.equal(g.mapTime(50, cuts), 24, 'inside a cut → cut point')
assert.equal(g.mapTime(130, cuts), 38)
const sh = g.shiftAlignment({ lines: ['a', 'b', 'c'], timestamps: [{ start: 0, end: 20 }, { start: 20, end: 120 }, { start: 120, end: 160 }], duration: 160 }, cuts)
assert.deepEqual(sh.timestamps, [{ start: 0, end: 20 }, { start: 20, end: 28 }, { start: 28, end: 68 }])
assert.equal(sh.duration, 68)
console.log('ok alignment shift')

// fixture audio: tone / silence / tone
const w = mkdtempSync(join(tmpdir(), 'silence-guard-'))
const mkAudio = (path, total, silStart, silEnd) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  `aevalsrc='if(between(t,${silStart},${silEnd}),0,0.3*sin(2*PI*440*t))':d=${total}:s=44100`, '-ac', '1', '-b:a', '128k', path])

// 4. generator: a chunk with runaway silence throws a retryable error; a normal one passes; retry re-renders
const bad = join(w, 'bad.mp3'); mkAudio(bad, 160, 20, 120)
const ok = join(w, 'ok.mp3'); mkAudio(ok, 40, 15, 25)
assert.throws(() => g.assertChunkHasNoRunawaySilence(readFileSync(bad), 'Hello. [long pause] [long pause] Bye.', join(w, 'c1.mp3')), /^Error: RUNAWAY_SILENCE/)
g.assertChunkHasNoRunawaySilence(readFileSync(ok), 'Hello. [long pause] Bye.', join(w, 'c2.mp3'))
assert.ok(!existsSync(join(w, 'c1.mp3')) && !existsSync(join(w, 'c2.mp3')), 'temp chunk files removed')
let calls = 0
const val = await retry(async () => { calls++; if (calls === 1) throw new Error('RUNAWAY_SILENCE: test'); return 'fresh' }, { baseMs: 1 })
assert.equal(val, 'fresh'); assert.equal(calls, 2, 'a runaway render is retried once more')
console.log('ok generator re-renders a runaway chunk')

// 5. QA gate fails on the runaway silence, then (after the trim) on the wrong listed duration, then passes
const content = join(w, 'content'), audio = join(w, 'audio')
mkdirSync(content); mkdirSync(join(audio, 'en'), { recursive: true })
const med = { slug: 'fx-runaway', category: 'meditate', isSleep: false, durationMin: 3, scriptEn: 'Hello there, this is a test.\n\n[10s pause]\n\nGoodbye now, this was a test.', scriptFr: '', breathing: null }
const writeMed = () => writeFileSync(join(content, 'fx-runaway.json'), JSON.stringify(med))
writeMed()
mkAudio(join(audio, 'en', 'fx-runaway.mp3'), 160, 20, 120)
const align = { lines: ['Hello there, this is a test.', '[long pause] [long pause]', 'Goodbye now, this was a test.'],
  timestamps: [{ start: 0, end: 20 }, { start: 20, end: 120 }, { start: 120, end: 160 }], duration: 160 }
writeFileSync(join(audio, 'en', 'fx-runaway.json'), JSON.stringify(align))
const env = { ...process.env, VESPER_QA_CONTENT_DIR: content, VESPER_QA_AUDIO_DIR: audio }
const qa = () => spawnSync('npx', ['tsx', join(root, 'scripts/qa-meditations.ts')], { cwd: root, env, encoding: 'utf8' })
let r = qa()
assert.equal(r.status, 1, r.stdout + r.stderr)
assert.match(r.stdout, /✗ no silence longer than the script asks for: 1 silence/, r.stderr.slice(-600))
console.log('ok QA fails on a runaway silence')

const trim = (...extra) => spawnSync('npx', ['tsx', join(root, 'scripts/trim-runaway-silence.ts'), 'en', 'fx-runaway',
  `--audio-dir=${audio}`, `--content-dir=${content}`, ...extra], { cwd: root, encoding: 'utf8' })
r = trim()
assert.notEqual(r.status, 0, 'refuses without a backup dir')
const backup = join(w, 'backup')
r = trim(`--backup-dir=${backup}`)
assert.equal(r.status, 0, r.stdout + r.stderr)
assert.ok(existsSync(join(backup, 'en', 'fx-runaway.mp3')) && existsSync(join(backup, 'en', 'fx-runaway.json')), 'original backed up')
const dur = parseFloat(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(audio, 'en', 'fx-runaway.mp3')]).toString())
assert.ok(Math.abs(dur - 68) < 0.5, `trimmed to ~68 s, got ${dur}`)
const trimmed = JSON.parse(readFileSync(join(audio, 'en', 'fx-runaway.json'), 'utf8'))
assert.deepEqual(trimmed.lines, align.lines)
assert.ok(Math.abs(trimmed.timestamps[2].start - 28) < 0.01 && Math.abs(trimmed.duration - dur) < 0.01)
const before2 = readFileSync(join(audio, 'en', 'fx-runaway.mp3'))
r = trim(`--backup-dir=${backup}`)
assert.equal(r.status, 0); assert.match(r.stdout, /nothing to trim/)
assert.deepEqual(readFileSync(join(audio, 'en', 'fx-runaway.mp3')), before2, 'second trim is a no-op')
console.log('ok trim removes dead air, keeps speech, idempotent')

r = qa()
assert.equal(r.status, 1, 'listed 3 min vs 1.1 min real must fail')
assert.doesNotMatch(r.stdout, /✗ no silence longer/)
assert.match(r.stdout, /✗ listed duration matches audio \(±15 %\): listed 3 min, audio 1\.1 min/)
med.durationMin = 1; writeMed()
r = qa()
assert.equal(r.status, 0, r.stdout)
console.log('ok QA fails on a wrong listed duration, passes once fixed')
