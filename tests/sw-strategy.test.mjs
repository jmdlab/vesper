// tests/sw-strategy.test.mjs — public/sw.js: pages (HTML navigations) must come from the network when online, so a deploy
// reaches returning visitors; the cached copy is only the offline fallback. Also: the viewport never blocks pinch-zoom.
//   node tests/sw-strategy.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const src = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')

function load({ online, cached }) {
  const store = new Map(Object.entries(cached))
  const handlers = {}
  const cache = { put: async (req, res) => { store.set(new URL(req.url).pathname, res) }, addAll: async () => {} }
  const self = {
    location: { origin: 'https://vesper.pm' },
    addEventListener: (t, f) => { handlers[t] = f },
    skipWaiting() {}, clients: { claim() {} },
  }
  const ctx = {
    self, URL, Response,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true,
      match: async (req) => store.get(new URL(typeof req === 'string' ? req : req.url).pathname) },
    fetch: async (req) => { if (!online) throw new TypeError('offline'); return new Response('fresh ' + new URL(req.url).pathname, { status: 200, headers: { 'content-type': 'text/html' } }) },
  }
  vm.runInNewContext(src, ctx)
  return async (url, mode = 'navigate') => {
    let p
    const request = { url, method: 'GET', mode, headers: new Headers({ accept: mode === 'navigate' ? 'text/html' : '*/*' }) }
    handlers.fetch({ request, respondWith: (x) => { p = x }, waitUntil() {} })
    return p ? (await p).text() : 'passthrough'
  }
}

let fails = 0
const check = async (name, fn) => { try { await fn(); console.log('ok', name) } catch (e) { fails++; console.log('FAIL', name, '-', e.message.split('\n')[0]) } }
const old = () => new Response('stale /home', { status: 200 })

await check('online navigation returns the fresh page, not the cached one', async () => {
  const get = load({ online: true, cached: { '/home': old() } })
  assert.equal(await get('https://vesper.pm/home'), 'fresh /home')
})
await check('offline navigation falls back to the cached page', async () => {
  const get = load({ online: false, cached: { '/home': old() } })
  assert.equal(await get('https://vesper.pm/home'), 'stale /home')
})
await check('hashed asset stays cache-first', async () => {
  const get = load({ online: true, cached: { '/_astro/a.123.js': new Response('cached js') } })
  assert.equal(await get('https://vesper.pm/_astro/a.123.js', 'no-cors'), 'cached js')
})
await check('viewport does not block pinch-zoom', async () => {
  const layout = fs.readFileSync(path.join(root, 'src/layouts/AppLayout.astro'), 'utf8')
  const vp = layout.match(/name="viewport" content="([^"]*)"/)[1]
  assert.doesNotMatch(vp, /maximum-scale\s*=\s*1\b|user-scalable\s*=\s*(no|0)/)
})
if (fails) { console.log(`${fails} failing`); process.exit(1) }
