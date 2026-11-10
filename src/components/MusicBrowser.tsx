import { useState, useRef, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useLocale } from '@/hooks/useLocale'
import { PageTransition, FadeIn, StaggerList, StaggerItem } from '@/components/Motion'
import musicTracks from '@/content/music.json'
import { BASE } from '@/lib/constants'

export function MusicBrowser() {
  const { locale, t } = useLocale()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(function syncStoredTrack() {
    setSelectedId(localStorage.getItem('vesper-music-track'))
  }, [])

  const handlePlay = useCallback((trackId: string, file: string) => {
    const audio = audioRef.current
    if (!audio) return

    if (playingId === trackId) {
      audio.pause()
      setPlayingId(null)
      return
    }

    audio.src = `${BASE}${file}`
    audio.volume = 0.3
    audio.play().catch(() => {})
    setPlayingId(trackId)
  }, [playingId])

  const handleSelect = useCallback((trackId: string | null) => {
    if (trackId === null || selectedId === trackId) {
      // Revert to random
      setSelectedId(null)
      localStorage.removeItem('vesper-music-track')
    } else {
      setSelectedId(trackId)
      localStorage.setItem('vesper-music-track', trackId)
    }
  }, [selectedId])

  const handleEnded = useCallback(() => {
    setPlayingId(null)
  }, [])

  return (
    <PageTransition>
      <main className="px-6 pb-8">
        <audio ref={audioRef} onEnded={handleEnded} />

        <header className="mb-2">
          <h1 className="font-[family-name:var(--font-serif)] text-3xl font-semibold text-[var(--primary)]">
            {t.ui.ambientMusic}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t.music.chooseBackground}
          </p>
        </header>

        <FadeIn delay={0.05}>
          <StaggerList className="mt-6 space-y-2" role="list">
            {/* Random option */}
            <StaggerItem role="listitem">
              <button
                onClick={() => handleSelect(null)}
                className="flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors"
                style={{
                  borderColor: selectedId === null ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: selectedId === null
                    ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))'
                    : 'var(--surface)',
                }}
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: selectedId === null
                      ? 'var(--accent)'
                      : 'color-mix(in srgb, var(--accent) 12%, transparent)',
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill={selectedId === null ? 'var(--bg)' : 'var(--accent)'}
                  >
                    <path fillRule="evenodd" d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.638-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.6 9.6 0 0 0 7.556 8a9.6 9.6 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.6 10.6 0 0 1 7 9.05c-.26.43-.638.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.6 9.6 0 0 0 6.444 8a9.6 9.6 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5"/>
                    <path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192"/>
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--primary)]">
                    {t.ui.random}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {t.ui.differentTrackEachSession}
                  </p>
                </div>
                {selectedId === null && (
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="var(--accent)">
                    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>
                  </svg>
                )}
              </button>
            </StaggerItem>

            {musicTracks.map((track) => {
              const isPlaying = playingId === track.id
              const isSelected = selectedId === track.id
              const name = locale === 'fr' ? track.nameFr : track.name

              return (
                <StaggerItem key={track.id} role="listitem">
                  <div
                    className="flex items-center gap-3 rounded-xl border p-4 transition-colors"
                    style={{
                      borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                      backgroundColor: isSelected ? 'color-mix(in srgb, var(--accent) 6%, var(--surface))' : 'var(--surface)',
                    }}
                  >
                    {/* Play/pause preview */}
                    <motion.button
                      onClick={() => handlePlay(track.id, track.file)}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
                      style={{
                        backgroundColor: isPlaying
                          ? 'var(--accent)'
                          : 'color-mix(in srgb, var(--accent) 12%, transparent)',
                      }}
                      whileTap={{ scale: 0.9 }}
                      aria-label={isPlaying ? `Pause ${name}` : `Play ${name}`}
                    >
                      {isPlaying ? (
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill={isPlaying ? 'var(--bg)' : 'var(--accent)'}>
                          <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>
                        </svg>
                      ) : (
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="var(--accent)">
                          <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>
                        </svg>
                      )}
                    </motion.button>

                    {/* Track info */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--primary)]">{name}</p>
                      {isSelected && (
                        <p className="mt-0.5 text-xs text-[var(--accent)]">
                          {t.ui.activeTrack}
                        </p>
                      )}
                    </div>

                    {/* Select / deselect button */}
                    {isSelected ? (
                      <button
                        onClick={() => handleSelect(track.id)}
                        className="shrink-0 p-1 transition-opacity hover:opacity-70"
                        aria-label={t.ui.deselect}
                      >
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="var(--accent)">
                          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSelect(track.id)}
                        className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        {t.ui.use}
                      </button>
                    )}
                  </div>
                </StaggerItem>
              )
            })}
          </StaggerList>
        </FadeIn>

        <FadeIn delay={0.2}>
          <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
            {t.music.loopDescription}
          </p>
        </FadeIn>
      </main>
    </PageTransition>
  )
}
