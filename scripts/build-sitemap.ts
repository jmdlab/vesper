/**
 * build-sitemap.ts — generate dist/sitemap.xml at build time.
 *
 * Includes: app routes, every meditation / sleep / breathing session page,
 * all /bible/{book}/ pages, all /bible/{book}/{chapter}/ pages.
 * Excludes: /home (canonical is /), /settings (robots-disallowed),
 *           /bible/search (a search UI, nothing to index).
 *
 * The session pages were missing until 2026-08-10: the sitemap listed only the
 * eight section landing pages, so the ~53 individual sessions — the site's most
 * differentiated content, each with a self-referential canonical — were left to
 * be discovered by internal linking alone. Google had indeed found most of the
 * meditations, but not the breathing exercises (URL Inspection returned
 * "Google ne reconnaît pas cette URL" for /breathe/4-7-8/). Routing rules below
 * mirror getStaticPaths in the corresponding [slug].astro files: isSleep splits
 * a meditation between /sleep/ and /meditate/.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BIBLE_DIR = join(ROOT, 'src', 'content', 'bible')
const MEDITATIONS_DIR = join(ROOT, 'src', 'content', 'meditations')
const BREATHING_DIR = join(ROOT, 'src', 'content', 'breathing')
const DIST_DIR = join(ROOT, 'dist')

/** Read every *.json in a content dir. Throws loudly rather than silently emitting a short sitemap. */
function readContent(dir: string): any[] {
  if (!existsSync(dir)) throw new Error(`content dir missing: ${dir}`)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')))
}

const SITE = 'https://vesper.pm'
const lastmod = new Date().toISOString().slice(0, 10)

interface BookMeta {
  slug: string
  nameEn: string
  chapterCount: number
}

const booksIndex: BookMeta[] = JSON.parse(readFileSync(join(BIBLE_DIR, '_books.json'), 'utf-8'))

// App routes (trailing slash to match canonical tags). /home and /settings excluded.
const appRoutes = ['/', '/about/', '/bible/', '/breathe/', '/meditate/', '/sleep/', '/today/', '/music/']

const urls: { loc: string; priority: string }[] = []

for (const route of appRoutes) {
  urls.push({ loc: `${SITE}${route}`, priority: route === '/' ? '1.0' : '0.8' })
}

// Session pages. Same split as getStaticPaths in meditate/[slug].astro and
// sleep/[slug].astro: isSleep decides which section the page is built under.
const meditations = readContent(MEDITATIONS_DIR)
for (const m of meditations) {
  const section = m.isSleep ? 'sleep' : 'meditate'
  urls.push({ loc: `${SITE}/${section}/${m.slug}/`, priority: '0.7' })
}

const breathing = readContent(BREATHING_DIR)
for (const p of breathing) {
  urls.push({ loc: `${SITE}/breathe/${p.slug}/`, priority: '0.7' })
}

for (const book of booksIndex) {
  urls.push({ loc: `${SITE}/bible/${book.slug}/`, priority: '0.7' })
  for (let ch = 1; ch <= book.chapterCount; ch++) {
    urls.push({ loc: `${SITE}/bible/${book.slug}/${ch}/`, priority: '0.6' })
  }
}

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n') +
  '\n</urlset>\n'

if (!existsSync(DIST_DIR)) {
  console.error(`dist/ not found at ${DIST_DIR} — run astro build first.`)
  process.exit(1)
}

writeFileSync(join(DIST_DIR, 'sitemap.xml'), xml)

const bookCount = booksIndex.length
const chapterCount = booksIndex.reduce((sum, b) => sum + b.chapterCount, 0)
const sleepCount = meditations.filter((m) => m.isSleep).length
console.log(
  `sitemap.xml written: ${urls.length} URLs (${appRoutes.length} app routes, ` +
    `${meditations.length - sleepCount} meditations, ${sleepCount} sleep, ${breathing.length} breathing, ` +
    `${bookCount} books, ${chapterCount} chapters)`
)

// Guard: every built page must be either in the sitemap or deliberately excluded.
// Without this the next route added to src/pages/ silently vanishes from Google,
// which is exactly how the session pages went missing.
const EXCLUDED = new Set(['/home/', '/settings/', '/bible/search/'])
const built = existsSync(DIST_DIR)
  ? (function walk(dir: string, acc: string[] = []): string[] {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name), acc)
        else if (e.name === 'index.html') acc.push(join(dir, e.name).slice(DIST_DIR.length).replace(/index\.html$/, ''))
      }
      return acc
    })(DIST_DIR)
  : []
const inSitemap = new Set(urls.map((u) => u.loc.slice(SITE.length)))
const orphans = built.filter((p) => !inSitemap.has(p) && !EXCLUDED.has(p))
if (orphans.length) {
  console.warn(`⚠ ${orphans.length} page(s) built but absent from sitemap and not excluded:`)
  for (const o of orphans.slice(0, 20)) console.warn(`   ${o}`)
  process.exitCode = 1
}
