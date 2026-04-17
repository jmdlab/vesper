import { useState, useCallback } from 'react'
import { useLocale } from '@/hooks/useLocale'
import { NavBar } from '@/components/NavBar'
import { BASE } from '@/lib/constants'
import type { BookWithCount } from '@/types'

interface SearchResult {
  id: string
  chapter: number
  verse: number
  textEn: string
  textFr: string
  bookSlug: string
  bookNameEn: string
  bookNameFr: string
  abbreviationEn: string
  abbreviationFr: string
}

interface SearchClientProps {
  books?: BookWithCount[]
}

type Tab = 'search' | 'browse'

export function SearchClient({ books = [] }: SearchClientProps) {
  const { locale, t } = useLocale()
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [testament, setTestament] = useState<'OT' | 'NT'>('OT')

  const search = useCallback(async () => {
    if (query.length < 2) return
    setLoading(true)
    setSearched(true)
    setSearchError(false)

    try {
      const res = await fetch(`${BASE}/search-index.json`)
      if (!res.ok) {
        setSearchError(true)
        setResults([])
        return
      }
      const allVerses: SearchResult[] = await res.json()

      const q = query.toLowerCase()
      const matches = allVerses
        .filter((v) => {
          const text = locale === 'fr' ? v.textFr : v.textEn
          return text.toLowerCase().includes(q)
        })
        .slice(0, 50)

      setResults(matches)
    } catch {
      setSearchError(true)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, locale])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') search()
  }

  const filteredBooks = books.filter((b) => b.testament === testament)

  return (
    <main className="px-6 pb-8">
      <NavBar title={t.nav.bible} />

      {/* Segmented control — iOS style */}
      <div className="mb-5 flex rounded-lg bg-[var(--surface)] p-0.5">
        <button
          onClick={() => setTab('search')}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
            tab === 'search'
              ? 'bg-[var(--bg)] text-[var(--primary)] shadow-sm'
              : 'text-[var(--muted)]'
          }`}
        >
          {t.bible.search}
        </button>
        <button
          onClick={() => setTab('browse')}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
            tab === 'browse'
              ? 'bg-[var(--bg)] text-[var(--primary)] shadow-sm'
              : 'text-[var(--muted)]'
          }`}
        >
          {t.ui.browse}
        </button>
      </div>

      {/* Search tab */}
      {tab === 'search' && (
        <>
          <div className="mb-6 flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.bible.searchPlaceholder}
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
              autoFocus
            />
            <button
              onClick={search}
              disabled={query.length < 2 || loading}
              className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t.bible.search}
            </button>
          </div>

          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse rounded-lg bg-[var(--surface)] p-4">
                  <div className="h-3 w-24 rounded bg-[var(--border)]" />
                  <div className="mt-2 h-4 w-full rounded bg-[var(--border)]" />
                  <div className="mt-1 h-4 w-3/4 rounded bg-[var(--border)]" />
                </div>
              ))}
            </div>
          )}

          {!loading && searchError && (
            <p className="py-12 text-center text-[var(--muted)]">
              {t.bible.searchUnavailable}
            </p>
          )}

          {!loading && searched && !searchError && results.length === 0 && (
            <p className="py-12 text-center text-[var(--muted)]">
              {t.bible.noResults}
            </p>
          )}

          {!loading && results.length > 0 && (
            <div className="space-y-3">
              {results.map((r) => {
                const bookName = locale === 'fr' ? r.bookNameFr : r.bookNameEn
                const text = locale === 'fr' ? r.textFr : r.textEn

                return (
                  <a
                    key={r.id}
                    href={`${BASE}/${r.bookSlug}/${r.chapter}`}
                    className="block rounded-lg border border-[var(--border)] p-4 transition-colors hover:bg-[var(--surface)]"
                  >
                    <p className="text-xs font-medium text-[var(--accent)]">
                      {bookName} {r.chapter}:{r.verse}
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-serif)] text-lg leading-relaxed text-[var(--primary)]">
                      {text}
                    </p>
                  </a>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Browse tab */}
      {tab === 'browse' && (
        <>
          {/* Testament segmented control */}
          <div className="mb-5 flex rounded-lg bg-[var(--surface)] p-0.5">
            <button
              onClick={() => setTestament('OT')}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                testament === 'OT'
                  ? 'bg-[var(--bg)] text-[var(--primary)] shadow-sm'
                  : 'text-[var(--muted)]'
              }`}
            >
              {t.bible.oldTestament}
            </button>
            <button
              onClick={() => setTestament('NT')}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                testament === 'NT'
                  ? 'bg-[var(--bg)] text-[var(--primary)] shadow-sm'
                  : 'text-[var(--muted)]'
              }`}
            >
              {t.bible.newTestament}
            </button>
          </div>

          {/* Book list */}
          <div className="space-y-0.5">
            {filteredBooks.map((book) => (
              <a
                key={book.slug}
                href={`${BASE}/${book.slug}`}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors active:bg-[var(--surface)]"
              >
                <span className="text-[var(--text)]">
                  {locale === 'fr' ? book.nameFr : book.nameEn}
                </span>
                <span className="text-xs tabular-nums text-[var(--muted)]">
                  {book.chapterCount} ch.
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
