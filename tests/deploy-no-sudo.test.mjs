// tests/deploy-no-sudo.test.mjs — the deploy root /var/www/vesper-static belongs to ubuntu: the pipeline must not wrap rsync
// in sudo (a password prompt blocked every non-interactive deploy, audit 10/11/2026 W5).   node tests/deploy-no-sudo.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts/pipeline.ts'), 'utf8')
assert.ok(!/run\(\s*['"]sudo['"]/.test(src), 'scripts/pipeline.ts still runs a command through sudo')
assert.ok(/run\(\s*['"]rsync['"],\s*\[\s*['"]-a['"],\s*['"]--delete['"]/.test(src), 'deploy rsync missing')
console.log('ok deploy rsync runs without sudo')
