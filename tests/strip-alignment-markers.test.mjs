// scripts/strip-alignment-markers.ts (audit 10/11/2026 W5): a leftover [BREATHING_SECTION] label in a final alignment is
// shown to the listener in the transcript and fails QA. The fix removes only zero-length marker lines, never a spoken one,
// and leaves the file untouched when anything looks off.   node tests/strip-alignment-markers.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = new URL('..', import.meta.url).pathname
const script = join(root, 'scripts/strip-alignment-markers.ts')
assert.ok(existsSync(script), 'scripts/strip-alignment-markers.ts missing')
const run = (...files) => spawnSync('npx', ['tsx', script, ...files], { cwd: root, encoding: 'utf8' })
const w = mkdtempSync(join(tmpdir(), 'align-'))
const ts = (s, e = s) => ({ start: s, end: e })

// 1. zero-length marker lines go, with their timestamps; everything else is byte-identical
const good = join(w, 'good.json')
const before = { lines: ['Rest.', '[BREATHING_SECTION]', 'Breathe.', ' [BREATHING_SECTION] ', 'End.'],
  timestamps: [ts(0, 2), ts(5), ts(5, 9), ts(12), ts(12, 14)], duration: 15 }
writeFileSync(good, JSON.stringify(before))
let r = run(good)
assert.equal(r.status, 0, r.stderr)
const after = JSON.parse(readFileSync(good, 'utf8'))
assert.deepEqual(after.lines, ['Rest.', 'Breathe.', 'End.'])
assert.deepEqual(after.timestamps, [ts(0, 2), ts(5, 9), ts(12, 14)])
assert.equal(after.duration, 15)
console.log('ok zero-length markers removed, rest unchanged')

// 2. idempotent
r = run(good); assert.equal(r.status, 0, r.stderr)
assert.deepEqual(JSON.parse(readFileSync(good, 'utf8')), after)
console.log('ok second run is a no-op')

// 3. a marker that HAS duration (spoken / audio behind it) is refused, file untouched
const spoken = join(w, 'spoken.json')
const sp = JSON.stringify({ lines: ['a', '[BREATHING_SECTION]', 'b'], timestamps: [ts(0, 1), ts(1, 4), ts(4, 5)], duration: 5 })
writeFileSync(spoken, sp)
r = run(spoken)
assert.notEqual(r.status, 0, 'a marker with duration must be refused')
assert.equal(readFileSync(spoken, 'utf8'), sp, 'refused file must stay byte-identical')
console.log('ok marker with duration refused')

// 4. lines/timestamps length mismatch is refused
const bad = join(w, 'bad.json')
const bd = JSON.stringify({ lines: ['a', '[BREATHING_SECTION]'], timestamps: [ts(0, 1)], duration: 1 })
writeFileSync(bad, bd)
r = run(bad)
assert.notEqual(r.status, 0); assert.equal(readFileSync(bad, 'utf8'), bd)
console.log('ok malformed alignment refused')
process.exit(0)
