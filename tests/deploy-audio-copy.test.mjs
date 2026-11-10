// Deploy step 3 must report an audio copy failure (audit 10/11/2026 W5: EACCES on a root-owned audio dir was printed and
// the deploy still ended on "Deploy complete!").   node tests/deploy-audio-copy.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = path.join(import.meta.dirname, '..')
const lib = path.join(root, 'scripts/lib/copy-audio.ts')
assert.ok(fs.existsSync(lib), 'scripts/lib/copy-audio.ts missing')
const w = fs.mkdtempSync(path.join(os.tmpdir(), 'vac-'))
const src = path.join(w, 'src'), dest = path.join(w, 'dest')
fs.mkdirSync(path.join(src, 'en'), { recursive: true }); fs.writeFileSync(path.join(src, 'en/a.mp3'), 'x')
fs.mkdirSync(path.join(src, 'fr'), { recursive: true }); fs.writeFileSync(path.join(src, 'fr/b.mp3'), 'y')
fs.mkdirSync(path.join(dest, 'fr'), { recursive: true }); fs.chmodSync(path.join(dest, 'fr'), 0o555)   // like the root-owned dir
const probe = `import { copyAudio } from ${JSON.stringify(lib)}; console.log(JSON.stringify(copyAudio(${JSON.stringify(src)}, ${JSON.stringify(dest)}, ['en','en-v2','fr'], () => {})))`
const r = spawnSync('npx', ['tsx', '--eval', probe], { cwd: root, encoding: 'utf8' })
fs.chmodSync(path.join(dest, 'fr'), 0o755)
assert.equal(r.status, 0, r.stderr)
const failures = JSON.parse(r.stdout.trim().split('\n').pop())
assert.equal(fs.readFileSync(path.join(dest, 'en/a.mp3'), 'utf8'), 'x', 'writable language copied')
assert.equal(failures.length, 1, 'the unwritable language is reported'); assert.match(failures[0], /^fr: .*EACCES/)
console.log('ok audio copy failure reported')
const pipe = fs.readFileSync(path.join(root, 'scripts/pipeline.ts'), 'utf8')
assert.match(pipe, /const failures = copyAudio\([\s\S]{0,200}if \(failures\.length\)[\s\S]{0,300}process\.exit\(1\)/, 'deploy must exit non-zero on audio copy failure')
console.log('ok deploy exits non-zero on it')
fs.rmSync(w, { recursive: true, force: true })
