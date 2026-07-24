import { useLocale } from '@/hooks/useLocale'
import { VerseDisplay } from '@/components/VerseDisplay'
import { NavBar } from '@/components/NavBar'
import type { BookWithCount, VerseData } from '@/types'
import { BASE } from '@/lib/constants'

interface ChapterReaderClientProps {
  book: BookWithCount
  chapter: number
  verses: VerseData[]
}

export function ChapterReaderClient({ book, chapter, verses }: ChapterReaderClientProps) {
  const { locale, t } = useLocale()

  const bookName = locale === 'fr' ? book.nameFr : book.nameEn
  const hasPrev = chapter > 1
  const hasNext = chapter < book.chapterCount

  return (
    <main className="px-6 pb-8">
      <NavBar title={`${bookName} ${chapter}`} />

      <article className="mx-auto max-w-lg">
        <VerseDisplay verses={verses} locale={locale} />
      </article>

      {/* Chapter navigation */}
      <nav className="mx-auto mt-10 flex max-w-lg items-center justify-between">
        {hasPrev ? (
          <a
            href={`${BASE}/bible/${book.slug}/${chapter - 1}/`}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            &larr; {t.bible.chapter} {chapter - 1}
          </a>
        ) : (
          <div />
        )}
        {hasNext ? (
          <a
            href={`${BASE}/bible/${book.slug}/${chapter + 1}/`}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {t.bible.chapter} {chapter + 1} &rarr;
          </a>
        ) : (
          <div />
        )}
      </nav>
    </main>
  )
}
