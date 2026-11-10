// tests/deploy-keeps-hidden.test.mjs — the deploy rsync --delete must never remove hidden top-level folders that live only on
// the server (e.g. a parked audio copy `.audio-root-old`, emptied by a deploy on 10/11/2026), nor the audio dir, while still
// deleting stale build files. Runs real rsync with the filter/exclude args read from scripts/pipeline.ts.
//   node tests/deploy-keeps-hidden.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts/pipeline.ts'), 'utf8')
const call = src.match(/run\(\s*'rsync',\s*\[([\s\S]*?)\]\)/)
assert.ok(call, 'deploy rsync call not found')
const args = [...call[1].matchAll(/'(--(?:exclude|filter)=[^']*)'/g)].map(m => m[1])
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-deploy-'))
const dist = path.join(tmp, 'dist'), dest = path.join(tmp, 'dest')
const put = (f, s = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s) }
put(path.join(dist, 'index.html'), 'new build')
put(path.join(dest, 'index.html'), 'old')
put(path.join(dest, 'stale.html'))
put(path.join(dest, 'audio/fr/a.mp3'))
put(path.join(dest, '.audio-root-old/fr/segments/a.mp3'))
execFileSync('rsync', ['-a', '--delete', ...args, `${dist}/`, `${dest}/`])
try {
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), 'new build', 'build file not updated')
  assert.ok(!fs.existsSync(path.join(dest, 'stale.html')), 'stale build file not deleted')
  assert.ok(fs.existsSync(path.join(dest, 'audio/fr/a.mp3')), 'deploy deleted served audio')
  assert.ok(fs.existsSync(path.join(dest, '.audio-root-old/fr/segments/a.mp3')), 'deploy deleted a hidden server-only folder')
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
console.log('ok deploy keeps hidden server-only folders and audio, deletes stale build files')
