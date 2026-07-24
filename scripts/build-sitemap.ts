/**
 * build-sitemap.ts — generate dist/sitemap.xml at build time.
 *
 * Includes: app routes, all /bible/{book}/ pages, all /bible/{book}/{chapter}/ pages.
 * Excludes: /home (canonical is /), /settings (robots-disallowed).
 * Run after `astro build` (wired into the `build` script in package.json).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BIBLE_DIR = join(ROOT, 'src', 'content', 'bible')
const DIST_DIR = join(ROOT, 'dist')

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
console.log(
  `sitemap.xml written: ${urls.length} URLs (${appRoutes.length} app routes, ${bookCount} books, ${chapterCount} chapters)`
)
