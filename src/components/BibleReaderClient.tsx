import { useState, useCallback, useRef, useEffect } from 'react'
import { useLocale } from '@/hooks/useLocale'
import { VerseDisplay } from '@/components/VerseDisplay'
import { BibleTTS } from '@/components/BibleTTS'
import type { TTSState } from '@/components/BibleTTS'
import { NavBar, SearchIcon, BookIcon, ListenIcon } from '@/components/NavBar'
import type { BookWithCount } from '@/types'
import { BASE } from '@/lib/constants'

interface VerseData {
  verse: number
  textEn: string
  textFr: string
}

interface BibleReaderClientProps {
  books: BookWithCount[]
  initialBook: BookWithCount | null
  initialChapter: number
  initialVerses: VerseData[]
  readingLabel: string
  readingLabelFr: string
  readingReason: string
  readingReasonFr: string
}

type ListenMode = 'off' | 'once' | 'continuous'

export function BibleReaderClient({
  books,
  initialBook,
  initialChapter,
  initialVerses,
}: BibleReaderClientProps) {
  const { locale, t } = useLocale()

  const [currentBook, setCurrentBook] = useState(initialBook)
  const [currentChapter, setCurrentChapter] = useState(initialChapter)
  const [verses, setVerses] = useState<VerseData[]>(initialVerses)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [navStep, setNavStep] = useState<'testament' | 'book' | 'chapter'>('testament')
  const [navTestament, setNavTestament] = useState<'OT' | 'NT'>('OT')
  const [listenMode, setListenMode] = useState<ListenMode>('off')
  const [ttsState, setTtsState] = useState<TTSState>('idle')
  const [autoPlay, setAutoPlay] = useState(false)
  const [activeVerseRange, setActiveVerseRange] = useState<[number, number] | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; chapter: number; verse: number; textEn: string; textFr: string; bookSlug: string; bookNameEn: string; bookNameFr: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchDone, setSearchDone] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const bookName = currentBook
    ? locale === 'fr' ? currentBook.nameFr : currentBook.nameEn
    : ''

  const fetchChapter = useCallback(async (bookSlug: string, chapter: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${BASE}/data/${bookSlug}.json`)
      if (!res.ok) {
        setError(t.bible.loadError)
        return
      }
      const data = await res.json()
      const chapterVerses = data.chapters[String(chapter)]
      if (chapterVerses) {
        setVerses(chapterVerses)
      } else {
        setError(t.bible.loadError)
      }
    } catch {
      setError(t.bible.loadError)
    } finally {
      setLoading(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [t.bible.loadError])

  const navigateTo = useCallback((book: BookWithCount, chapter: number) => {
    setCurrentBook(book)
    setCurrentChapter(chapter)
    setNavOpen(false)
    setNavStep('testament')
    fetchChapter(book.slug, chapter)
  }, [fetchChapter])

  const goToPrev = useCallback(() => {
    if (!currentBook) return
    if (currentChapter > 1) {
      navigateTo(currentBook, currentChapter - 1)
    } else {
      const idx = books.findIndex((b) => b.slug === currentBook.slug)
      if (idx > 0) {
        const prevBook = books[idx - 1]
        navigateTo(prevBook, prevBook.chapterCount)
      }
    }
  }, [currentBook, currentChapter, books, navigateTo])

  const goToNext = useCallback(() => {
    if (!currentBook) return
    if (currentChapter < currentBook.chapterCount) {
      navigateTo(currentBook, currentChapter + 1)
    } else {
      const idx = books.findIndex((b) => b.slug === currentBook.slug)
      if (idx < books.length - 1) {
        navigateTo(books[idx + 1], 1)
      }
    }
  }, [currentBook, currentChapter, books, navigateTo])

  const hasNext = (() => {
    if (!currentBook) return false
    if (currentChapter < currentBook.chapterCount) return true
    const idx = books.findIndex((b) => b.slug === currentBook.slug)
    return idx < books.length - 1
  })()

  // ─── Listen toggle — tap toggles on/off, no cycling ───────────────────────
  const toggleListen = useCallback(() => {
    setListenMode(prev => {
      if (prev === 'off') return 'once'
      setAutoPlay(false)
      return 'off'
    })
  }, [])

  const isListening = listenMode !== 'off'
  const isTTSActive = ttsState === 'playing' || ttsState === 'generating' || ttsState === 'loading-model'

  const filteredBooks = books.filter((b) => b.testament === navTestament)

  // ─── Search ────────────────────────────────────────────────────────────────
  const doSearch = useCallback(async () => {
    if (searchQuery.length < 2) return
    setSearchLoading(true)
    setSearchDone(true)
    try {
      const res = await fetch(`${BASE}/search-index.json`)
      const all = await res.json()
      const q = searchQuery.toLowerCase()
      setSearchResults(
        all.filter((v: { textEn: string; textFr: string }) =>
          (locale === 'fr' ? v.textFr : v.textEn).toLowerCase().includes(q)
        ).slice(0, 30)
      )
    } catch {
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }, [searchQuery, locale])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    setSearchDone(false)
  }, [])

  // ─── Sheet drag-to-dismiss ─────────────────────────────────────────────────
  const dragStartY = useRef(0)
  const dragDelta = useRef(0)

  function onSheetTouchStart(e: React.TouchEvent) {
    dragStartY.current = e.touches[0].clientY
    dragDelta.current = 0
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none'
    }
  }

  function onSheetTouchMove(e: React.TouchEvent) {
    const delta = e.touches[0].clientY - dragStartY.current
    dragDelta.current = Math.max(0, delta) // only drag down
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dragDelta.current}px)`
    }
  }

  function onSheetTouchEnd() {
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      if (dragDelta.current > 120) {
        // Dismiss
        sheetRef.current.style.transform = 'translateY(100%)'
        setTimeout(() => setNavOpen(false), 350)
      } else {
        sheetRef.current.style.transform = 'translateY(0)'
      }
    }
    dragDelta.current = 0
  }

  // Group books by category for iOS grouped list
  const bookCategories = (() => {
    if (navTestament === 'OT') {
      return [
        { label: t.bible.pentateuch, books: filteredBooks.slice(0, 5) },
        { label: t.bible.historical, books: filteredBooks.slice(5, 17) },
        { label: t.bible.poetry, books: filteredBooks.slice(17, 22) },
        { label: t.bible.majorProphets, books: filteredBooks.slice(22, 27) },
        { label: t.bible.minorProphets, books: filteredBooks.slice(27) },
      ].filter(g => g.books.length > 0)
    }
    return [
      { label: t.bible.gospels, books: filteredBooks.slice(0, 4) },
      { label: t.bible.history, books: filteredBooks.slice(4, 5) },
      { label: t.bible.paulineEpistles, books: filteredBooks.slice(5, 18) },
      { label: t.bible.generalEpistles, books: filteredBooks.slice(18, 25) },
      { label: t.bible.prophecy, books: filteredBooks.slice(25) },
    ].filter(g => g.books.length > 0)
  })()

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 pb-8">
      <NavBar
        title={`${bookName} ${currentChapter}`}
        titleAlign="left"
        trailingActions={[
          {
            onClick: () => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 100) },
            icon: <SearchIcon />,
            label: 'Search',
          },
          {
            onClick: () => { setNavOpen(!navOpen); setNavStep('testament') },
            icon: <BookIcon />,
            label: 'Browse',
          },
          {
            onClick: toggleListen,
            icon: <ListenIcon active={isListening || isTTSActive} />,
            label: isListening ? t.ui.stop : t.bible.listen,
          },
        ]}
      />

      {/* TTS — headless, controlled by NavBar listen icon */}
      {!loading && verses.length > 0 && listenMode !== 'off' && (
        <BibleTTS
          verses={verses}
          locale={locale}
          autoPlay={autoPlay}
          playing={isListening}
          onStateChange={setTtsState}
          onComplete={() => {
            if (listenMode === 'continuous' && hasNext) {
              setAutoPlay(true)
              goToNext()
            } else {
              setAutoPlay(false)
              setListenMode('off')
            }
          }}
          onStop={() => { setAutoPlay(false); setListenMode('off') }}
          onChunkChange={(start, end) => {
            setActiveVerseRange(start >= 0 ? [start, end] : null)
          }}
        />
      )}

      {/* ─── iOS 26 Browse Sheet ──────────────────────────────────────────── */}
      {navOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[60]"
            style={{
              backgroundColor: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              animation: 'fade-in 0.25s ease-out',
            }}
            onClick={() => setNavOpen(false)}
          />

          {/* Sheet */}
          <div
            ref={sheetRef}
            className="fixed left-0 right-0 bottom-0 z-[70] flex max-h-[85vh] flex-col overflow-hidden"
            style={{
              borderRadius: '20px 20px 0 0',
              background: 'var(--bg)',
              boxShadow: '0 -2px 16px rgba(0,0,0,0.12)',
              animation: 'sheet-up 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
            onTouchStart={onSheetTouchStart}
            onTouchMove={onSheetTouchMove}
            onTouchEnd={onSheetTouchEnd}
          >
            {/* Drag handle */}
            <div className="flex justify-center py-2">
              <div
                className="h-[5px] w-9 rounded-full"
                style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
              />
            </div>

            {/* Testament / Book / Chapter content */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {navStep === 'testament' && (
                <>
                  <h2 className="mb-3 text-lg font-semibold text-[var(--primary)]">
                    {t.nav.bible}
                  </h2>
                  <div className="overflow-hidden rounded-[10px] bg-[var(--surface)]">
                    <button
                      onClick={() => { setNavTestament('OT'); setNavStep('book') }}
                      className="flex w-full items-center justify-between px-4 py-[14px] text-left text-[17px] text-[var(--text)] active:bg-[var(--border)]"
                    >
                      {t.bible.oldTestament}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--muted)" className="opacity-60">
                        <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708" />
                      </svg>
                    </button>
                    <div className="mx-4 h-[0.33px] bg-[var(--border)]" />
                    <button
                      onClick={() => { setNavTestament('NT'); setNavStep('book') }}
                      className="flex w-full items-center justify-between px-4 py-[14px] text-left text-[17px] text-[var(--text)] active:bg-[var(--border)]"
                    >
                      {t.bible.newTestament}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--muted)" className="opacity-60">
                        <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708" />
                      </svg>
                    </button>
                  </div>
                </>
              )}

              {navStep === 'book' && (
                <>
                  {/* Back + title */}
                  <button
                    onClick={() => setNavStep('testament')}
                    className="mb-3 flex items-center gap-1 text-[var(--accent)] active:opacity-70"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0" />
                    </svg>
                    <span className="text-[17px]">
                      {navTestament === 'OT' ? t.bible.oldTestament : t.bible.newTestament}
                    </span>
                  </button>

                  {/* Grouped list sections */}
                  {bookCategories.map((group) => (
                    <div key={group.label} className="mb-4">
                      <p className="mb-1 px-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {group.label}
                      </p>
                      <div className="overflow-hidden rounded-[10px] bg-[var(--surface)]">
                        {group.books.map((b, i) => (
                          <div key={b.slug}>
                            {i > 0 && <div className="ml-4 h-[0.33px] bg-[var(--border)]" />}
                            <button
                              onClick={() => {
                                setAutoPlay(false)
                                if (b.chapterCount === 1) {
                                  navigateTo(b, 1)
                                } else {
                                  setCurrentBook(b)
                                  setNavStep('chapter')
                                }
                              }}
                              className={`flex w-full items-center justify-between px-4 py-[11px] text-left active:bg-[var(--border)] ${
                                currentBook?.slug === b.slug ? 'text-[var(--accent)]' : 'text-[var(--text)]'
                              }`}
                            >
                              <span className="text-[17px]">
                                {locale === 'fr' ? b.nameFr : b.nameEn}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] tabular-nums text-[var(--muted)]">
                                  {b.chapterCount}
                                </span>
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--muted)" className="opacity-40">
                                  <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708" />
                                </svg>
                              </div>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {navStep === 'chapter' && currentBook && (
                <>
                  {/* Back + book name */}
                  <button
                    onClick={() => setNavStep('book')}
                    className="mb-3 flex items-center gap-1 text-[var(--accent)] active:opacity-70"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0" />
                    </svg>
                    <span className="text-[17px]">
                      {locale === 'fr' ? currentBook.nameFr : currentBook.nameEn}
                    </span>
                  </button>

                  <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {t.bible.chapter}
                  </p>

                  {/* Chapter grid */}
                  <div className="grid grid-cols-6 gap-2">
                    {Array.from({ length: currentBook.chapterCount }, (_, i) => i + 1).map((ch) => (
                      <button
                        key={ch}
                        onClick={() => { setAutoPlay(false); navigateTo(currentBook, ch) }}
                        className={`flex h-11 items-center justify-center rounded-[10px] text-[15px] tabular-nums transition-colors active:scale-95 ${
                          ch === currentChapter
                            ? 'bg-[var(--accent)] font-semibold text-white'
                            : 'bg-[var(--surface)] text-[var(--text)] active:bg-[var(--border)]'
                        }`}
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ─── iOS 26 Search Bar + Results ──────────────────────────────────── */}
      {searchOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[60]"
            style={{
              backgroundColor: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              animation: 'fade-in 0.25s ease-out',
            }}
            onClick={closeSearch}
          />

          {/* Search panel — slides down from top */}
          <div
            className="fixed left-0 right-0 top-0 z-[70] flex max-h-[80vh] flex-col"
            style={{
              background: 'var(--bg)',
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
              boxShadow: '0 2px 16px rgba(0,0,0,0.12)',
              animation: 'search-down 0.25s ease-out',
            }}
          >
            {/* iOS search bar */}
            <div className="flex items-center gap-2 px-4 pb-3">
              <div
                className="flex flex-1 items-center gap-2 px-3"
                style={{
                  height: '36px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(118,118,128,0.12)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--muted)" className="shrink-0 opacity-60">
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
                  placeholder={t.bible.searchPlaceholder}
                  className="flex-1 bg-transparent text-[17px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchDone(false) }}
                    className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[var(--muted)]"
                  >
                    <svg width="8" height="8" viewBox="0 0 16 16" fill="var(--bg)">
                      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                onClick={closeSearch}
                className="shrink-0 text-[17px] text-[var(--accent)] active:opacity-70"
                style={{ animation: 'slide-in-right 0.25s ease-out' }}
              >
                {t.ui.cancel}
              </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {searchLoading && (
                <div className="space-y-2 px-4 py-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse rounded-[10px] bg-[var(--surface)] p-4">
                      <div className="h-3 w-20 rounded bg-[var(--border)]" />
                      <div className="mt-2 h-4 w-full rounded bg-[var(--border)]" />
                    </div>
                  ))}
                </div>
              )}

              {!searchLoading && searchDone && searchResults.length === 0 && (
                <div className="flex flex-col items-center py-16">
                  <svg width="48" height="48" viewBox="0 0 16 16" fill="var(--muted)" className="mb-3 opacity-30">
                    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
                  </svg>
                  <p className="text-[17px] font-semibold text-[var(--primary)]">
                    {t.bible.noResults}
                  </p>
                  <p className="mt-1 text-[15px] text-[var(--muted)]">
                    {t.bible.noResultsDetail} &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
              )}

              {!searchLoading && !searchDone && (
                <div className="flex flex-col items-center py-16 opacity-40">
                  <svg width="48" height="48" viewBox="0 0 16 16" fill="var(--muted)" className="mb-3">
                    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
                  </svg>
                  <p className="text-[15px] text-[var(--muted)]">
                    {t.bible.searchPlaceholder}
                  </p>
                </div>
              )}

              {!searchLoading && searchResults.length > 0 && (
                <div className="px-4 pb-4">
                  <div className="overflow-hidden rounded-[10px] bg-[var(--surface)]">
                    {searchResults.map((r, i) => {
                      const rBookName = locale === 'fr' ? r.bookNameFr : r.bookNameEn
                      const rText = locale === 'fr' ? r.textFr : r.textEn
                      const book = books.find((b) => b.slug === r.bookSlug)
                      return (
                        <div key={r.id}>
                          {i > 0 && <div className="ml-4 h-[0.33px] bg-[var(--border)]" />}
                          <button
                            onClick={() => {
                              if (book) navigateTo(book, r.chapter)
                              closeSearch()
                            }}
                            className="w-full px-4 py-3 text-left active:bg-[var(--border)]"
                          >
                            <p className="text-[13px] font-medium text-[var(--accent)]">
                              {rBookName} {r.chapter}:{r.verse}
                            </p>
                            <p className="mt-0.5 line-clamp-2 font-[family-name:var(--font-serif)] text-[17px] leading-snug text-[var(--primary)]">
                              {rText}
                            </p>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ─── Inline TTS indicator (subtle, below nav) ─────────────────────── */}
      {isTTSActive && (
        <div className="mb-3 flex items-center justify-center gap-2 text-[13px] text-[var(--accent)]">
          {ttsState === 'loading-model' && (
            <>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
              </svg>
              <span>{t.tts.loadingModel}</span>
            </>
          )}
          {ttsState === 'generating' && (
            <>
              <svg className="animate-pulse" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M8.5 2a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-1 0v-11a.5.5 0 0 1 .5-.5m-2 2a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5m4 0a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5m-6 1.5A.5.5 0 0 1 5 6v4a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m8 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m-10 1A.5.5 0 0 1 3 7v2a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5m12 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5"/>
              </svg>
              <span>{t.tts.generating}</span>
            </>
          )}
          {ttsState === 'playing' && (
            <>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="animate-pulse">
                <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/>
                <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z"/>
                <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06"/>
              </svg>
              <span>{t.tts.playing}</span>
            </>
          )}
        </div>
      )}

      {/* Prev / Next chapter — between nav bar and text */}
      <nav className="mb-4 flex items-center justify-between">
        <button
          onClick={() => { setAutoPlay(false); goToPrev() }}
          className="flex items-center gap-1 rounded-[10px] px-3 py-2 text-[15px] text-[var(--muted)] transition-colors active:bg-[var(--surface)] active:scale-[0.97] disabled:opacity-30"
          disabled={!currentBook || (currentChapter <= 1 && books[0]?.slug === currentBook?.slug)}
          aria-label={t.bible.previousChapter}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0" />
          </svg>
          {t.bible.previous}
        </button>
        <span className="text-[13px] tabular-nums text-[var(--muted)]">
          {currentChapter} / {currentBook?.chapterCount ?? '—'}
        </span>
        <button
          onClick={() => { setAutoPlay(false); goToNext() }}
          className="flex items-center gap-1 rounded-[10px] px-3 py-2 text-[15px] text-[var(--muted)] transition-colors active:bg-[var(--surface)] active:scale-[0.97] disabled:opacity-30"
          disabled={!currentBook || (currentChapter >= (currentBook?.chapterCount ?? 0) && books[books.length - 1]?.slug === currentBook?.slug)}
          aria-label={t.bible.nextChapter}
        >
          {t.bible.next}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708" />
          </svg>
        </button>
      </nav>

      {/* Verse content */}
      <div ref={contentRef} className="flex-1">
        {loading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-[var(--surface)]" style={{ width: `${60 + Math.random() * 40}%` }} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-[17px] text-[var(--muted)]">{error}</p>
            <button
              onClick={() => currentBook && fetchChapter(currentBook.slug, currentChapter)}
              className="mt-4 rounded-lg bg-[var(--surface)] px-4 py-2 text-sm text-[var(--accent)] transition-colors active:opacity-70"
            >
              {t.bible.next === 'Next' ? 'Retry' : 'Réessayer'}
            </button>
          </div>
        ) : (
          <article className="mx-auto max-w-lg">
            <VerseDisplay verses={verses} locale={locale} activeRange={activeVerseRange} />
          </article>
        )}
      </div>
    </main>
  )
}
