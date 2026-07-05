import { useState } from 'react'
import { useLocale } from '@/hooks/useLocale'
import type { BookWithCount } from '@/types'
import { BASE } from '@/lib/constants'

interface TodaysReading {
  book: {
    slug: string
    nameEn: string
    nameFr: string
  }
  chapter: number
  label: string
  labelFr: string
  verses: {
    verse: number
    textEn: string
    textFr: string
  }[]
}

interface BibleBooksClientProps {
  books: BookWithCount[]
  todaysReading: TodaysReading | null
}

export function BibleBooksClient({ books, todaysReading }: BibleBooksClientProps) {
  const { locale, t } = useLocale()
  const [tab, setTab] = useState<'OT' | 'NT'>('OT')

  const filtered = books.filter((b) => b.testament === tab)

  return (
    <main className="px-6 pt-12 pb-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-[family-name:var(--font-serif)] text-3xl font-semibold text-[var(--primary)]">
          {t.nav.bible}
        </h1>
        <div className="flex items-center gap-3">
          <a
            href={`${BASE}/bible/search`}
            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {t.bible.search}
          </a>
        </div>
      </header>

      {/* Today's Reading */}
      {todaysReading && (
        <a
          href={`${BASE}/bible/${todaysReading.book.slug}/${todaysReading.chapter}`}
          className="mb-8 block rounded-xl bg-[var(--surface)] p-5 transition-colors hover:bg-[var(--border)]"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--accent)]">
            {locale === 'fr' ? todaysReading.labelFr : todaysReading.label}
          </p>
          <p className="mt-2 font-[family-name:var(--font-serif)] text-xl font-semibold text-[var(--primary)]">
            {locale === 'fr' ? todaysReading.book.nameFr : todaysReading.book.nameEn}{' '}
            {todaysReading.chapter}
          </p>
          {todaysReading.verses.length > 0 && (
            <p className="mt-3 line-clamp-3 font-[family-name:var(--font-serif)] text-base leading-relaxed text-[var(--muted)]">
              {todaysReading.verses
                .map((v) => (locale === 'fr' ? v.textFr : v.textEn))
                .join(' ')}
            </p>
          )}
          <p className="mt-3 text-xs text-[var(--accent)]">
            {t.bible.readChapter} &rarr;
          </p>
        </a>
      )}

      {/* Tabs */}
      <div className="mb-6 flex border-b border-[var(--border)]">
        <button
          onClick={() => setTab('OT')}
          className={`flex-1 pb-2.5 text-sm font-medium transition-colors ${
            tab === 'OT'
              ? 'border-b-2 border-[var(--accent)] text-[var(--primary)]'
              : 'text-[var(--muted)]'
          }`}
        >
          {t.bible.oldTestament}
        </button>
        <button
          onClick={() => setTab('NT')}
          className={`flex-1 pb-2.5 text-sm font-medium transition-colors ${
            tab === 'NT'
              ? 'border-b-2 border-[var(--accent)] text-[var(--primary)]'
              : 'text-[var(--muted)]'
          }`}
        >
          {t.bible.newTestament}
        </button>
      </div>

      {/* Book list */}
      <div className="space-y-1">
        {filtered.map((book) => (
          <a
            key={book.slug}
            href={`${BASE}/bible/${book.slug}`}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--surface)]"
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
    </main>
  )
}
