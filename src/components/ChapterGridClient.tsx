import { useLocale } from '@/hooks/useLocale'
import type { BookWithCount } from '@/types'
import { BASE } from '@/lib/constants'

interface ChapterGridClientProps {
  book: BookWithCount
}

export function ChapterGridClient({ book }: ChapterGridClientProps) {
  const { locale, t } = useLocale()

  const bookName = locale === 'fr' ? book.nameFr : book.nameEn

  return (
    <main className="px-6 pt-12 pb-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-serif)] text-2xl font-semibold text-[var(--primary)]">
          {bookName}
        </h1>
      </header>

      <p className="mb-6 text-sm text-[var(--muted)]">
        {book.chapterCount} {t.bible.chapter.toLowerCase()}{book.chapterCount > 1 ? 's' : ''}
      </p>

      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
        {Array.from({ length: book.chapterCount }, (_, i) => i + 1).map((ch) => (
          <a
            key={ch}
            href={`${BASE}/bible/${book.slug}/${ch}`}
            className="flex aspect-square items-center justify-center rounded-lg border border-[var(--border)] tabular-nums text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--surface)] hover:border-[var(--accent)]"
          >
            {ch}
          </a>
        ))}
      </div>
    </main>
  )
}
