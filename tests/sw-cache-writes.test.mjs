// tests/sw-cache-writes.test.mjs — public/sw.js cache writes (audit 10/11/2026):
// W6: audio is range-requested (206): the SW must leave it to the network and never feed a 206 to cache.put (it rejects).
// M4: every cache write is held by event.waitUntil (an unawaited put can be killed with the worker, its error unhandled).
// M5: a 5xx from the network falls back to the cached copy, like a network error.
//   node tests/sw-cache-writes.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'public/sw.js'), 'utf8')
const store = new Map(); const puts = []
const cache = { put: async (req, res) => { puts.push(res.status); if (res.status !== 200) throw new TypeError('Partial response'); store.set(new URL(req.url).pathname, res) }, addAll: async () => {} }
const handlers = {}
let net = async () => new Response('x', { status: 200 })
vm.runInNewContext(src, {
  self: { location: { origin: 'https://vesper.pm' }, addEventListener: (t, f) => { handlers[t] = f }, skipWaiting() {}, clients: { claim() {} } },
  URL, Response,
  caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async (r) => store.get(new URL(typeof r === 'string' ? r : r.url).pathname) },
  fetch: (r) => net(r),
})
const go = async (url, accept = '*/*') => {
  let p = null; const held = []
  handlers.fetch({ request: { url, method: 'GET', mode: 'no-cors', headers: new Headers({ accept }) }, respondWith: (x) => { p = x }, waitUntil: (x) => held.push(x) })
  const res = p ? await p : null
  await Promise.all(held)
  return { res, held }
}
// W6
{
  net = async () => new Response('part', { status: 206 })
  const { res } = await go('https://vesper.pm/audio/en/a.mp3')
  assert.equal(res, null, 'audio must go straight to the network (range requests), not through the SW cache')
  assert.equal(puts.length, 0, 'a 206 was fed to cache.put')
  console.log('ok audio left to the network, no 206 cached')
}
// M4
{
  net = async () => new Response('img', { status: 200 })
  const { held } = await go('https://vesper.pm/icon-192.png')
  assert.ok(held.length >= 1, 'cache write not held by event.waitUntil')
  assert.ok(store.has('/icon-192.png'))
  console.log('ok cache writes held by waitUntil')
}
// M5
{
  store.set('/data/books.json', new Response('cached', { status: 200 }))
  net = async () => new Response('bad gateway', { status: 502 })
  const { res } = await go('https://vesper.pm/data/books.json')
  assert.equal(await res.text(), 'cached', 'a 5xx hid the cached copy')
  console.log('ok 5xx falls back to the cache')
}
process.exit(0)
