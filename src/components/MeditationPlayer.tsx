import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useLocale } from '@/hooks/useLocale'
import { useCrossfadeLoop } from '@/hooks/useCrossfadeLoop'
import { NavBar } from '@/components/NavBar'
import { BASE, VOICES } from '@/lib/constants'
import { RelaxAnimation } from '@/components/RelaxAnimation'
import musicTracks from '@/content/music.json'
import type { MeditationData } from '@/types'

interface MeditationPlayerProps {
  meditation: MeditationData
  backHref: string
}

interface AlignmentData {
  lines: string[]
  timestamps: Array<{ start: number; end: number }>
  duration: number
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}



export function MeditationPlayer({ meditation, backHref }: MeditationPlayerProps) {
  const { locale, t } = useLocale()
  const audioRef = useRef<HTMLAudioElement>(null)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [activeVoice, setActiveVoice] = useState<'v1' | 'v2'>(() => {
    if (typeof window === 'undefined') return 'v1'
    return localStorage.getItem('vesper-voice') === 'alt' ? 'v2' : 'v1'
  })
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null)
  const [musicOn, setMusicOn] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('vesper-music') !== 'off'
  })
  const [musicVolume, setMusicVolume] = useState(() => {
    if (typeof window === 'undefined') return 0.015
    const stored = localStorage.getItem('vesper-music-volume')
    return stored ? parseFloat(stored) : 0.015
  })

  // Honor the track picked in MusicBrowser (stored as its id under
  // 'vesper-music-track'); fall back to a random track when none is selected.
  const [ambientTrackUrl] = useState(() => {
    const storedId = typeof window === 'undefined' ? null : localStorage.getItem('vesper-music-track')
    const track =
      (storedId && musicTracks.find((t) => t.id === storedId)) ||
      musicTracks[Math.floor(Math.random() * musicTracks.length)]
    return `${BASE}${track.file}`
  })

  const isMusic = meditation.category === 'music' && !meditation.scriptEn

  // Crossfade loop for ambient background music (non-music meditations)
  const ambient = useCrossfadeLoop(!isMusic ? ambientTrackUrl : null)

  const title = locale === 'fr' ? meditation.titleFr : meditation.titleEn
  const desc = locale === 'fr' ? meditation.descFr : meditation.descEn
  const script = locale === 'fr' ? meditation.scriptFr : meditation.scriptEn
  const baseAudioPath = locale === 'fr' ? meditation.audioPathFr : meditation.audioPathEn

  // Available duration variants from segmentation
  const langKey = locale === 'fr' ? 'fr' : 'en'
  const availableDurations = meditation.segments?.[langKey]?.durations ?? []

  // Build audio path: if a duration variant is selected, use the assembled file
  const resolvedAudioPath = useMemo(() => {
    if (!baseAudioPath) return null

    if (selectedDuration && availableDurations.includes(selectedDuration)) {
      // Assembled variant: /audio/en/segments/{slug}/assembled/{duration}min.mp3
      const langDir = locale === 'fr' ? 'fr' : 'en'
      return `/audio/${langDir}/segments/${meditation.slug}/assembled/${selectedDuration}min.mp3`
    }

    return baseAudioPath
  }, [baseAudioPath, selectedDuration, availableDurations, locale, meditation.slug])

  // Don't apply v2 voice replacement to assembled duration variants
  // (they only exist in the base voice directory)
  const isDurationVariant = selectedDuration !== null
  const audioPath = resolvedAudioPath
    ? isMusic
      ? `${BASE}${resolvedAudioPath}`
      : `${BASE}${activeVoice === 'v2' && !isDurationVariant
        ? resolvedAudioPath.replace('/audio/en/', '/audio/en-v2/').replace('/audio/fr/', '/audio/fr-v2/')
        : resolvedAudioPath}`
    : null

  const [hasV2, setHasV2] = useState(false)
  useEffect(() => {
    if (!baseAudioPath) return
    const v2Path = `${BASE}${baseAudioPath.replace('/audio/en/', '/audio/en-v2/').replace('/audio/fr/', '/audio/fr-v2/')}`
    fetch(v2Path, { method: 'HEAD' })
      .then(r => setHasV2(r.ok))
      .catch(() => setHasV2(false))
  }, [baseAudioPath])

  const [alignment, setAlignment] = useState<AlignmentData | null>(null)
  useEffect(function fetchAlignment() {
    if (!audioPath || isMusic) {
      setAlignment(null)
      return
    }
    const jsonPath = audioPath.replace(/\.mp3$/, '.json')
    fetch(jsonPath)
      .then(r => {
        if (!r.ok) throw new Error('not found')
        return r.json() as Promise<AlignmentData>
      })
      .then(data => {
        if (data.timestamps && data.lines && data.duration) {
          setAlignment(data)
        }
      })
      .catch(() => setAlignment(null))
  }, [audioPath])

  const handleVoiceChange = useCallback((voice: 'v1' | 'v2') => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsPlaying(false)
    setCurrentTime(0)
    setActiveVoice(voice)
    localStorage.setItem('vesper-voice', voice === 'v2' ? 'alt' : 'default')
  }, [])

  const handleDurationChange = useCallback((dur: number | null) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setAlignment(null)
    setSelectedDuration(dur)
    ambient.pause()
  }, [])

  // Note: line-level parsing, boundary tracking, and DOM index mapping were
  // removed along with karaoke highlighting. Prayer text uses a simple
  // script.split('\n') directly in the JSX below.

  // For music sessions: the playable zone between fade-in and fade-out
  const musicZone = useMemo(() => {
    if (!isMusic || duration <= 120) return null
    const fadeIn = 95 // skip past 90s ISO fade-in
    const fadeOutStart = duration - 35 // 30s fade-out + 5s buffer
    return { start: fadeIn, end: fadeOutStart, length: fadeOutStart - fadeIn }
  }, [isMusic, duration])

  const handleTimeUpdateWithScroll = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const time = audio.currentTime

    // Music seamless loop: jump past fade-in before the fade-out starts
    if (musicZone && time >= musicZone.end) {
      audio.currentTime = musicZone.start
      return
    }

    setCurrentTime(time)

    // Karaoke/line-tracking intentionally removed — only prayer meditations
    // display script text (static render in the JSX below), so no line-by-line
    // time cursor is needed for the main player.
  }, [duration, isMusic, musicZone])

  useEffect(() => {
    if (!('mediaSession' in navigator) || !audioPath) return

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: 'Vesper',
      album: meditation.category,
    })

    navigator.mediaSession.setActionHandler('play', () => {
      audioRef.current?.play()
      if (musicOn) ambient.play()
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause()
      ambient.pause()
    })
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15)
    })
    navigator.mediaSession.setActionHandler('seekforward', () => {
      if (audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.duration, audioRef.current.currentTime + 15)
    })
  }, [title, meditation.category, audioPath, musicOn])

  useEffect(() => {
    ambient.setVolume(musicVolume)
  }, [musicVolume])

  const toggleMusic = useCallback(() => {
    const next = !musicOn
    setMusicOn(next)
    localStorage.setItem('vesper-music', next ? 'on' : 'off')
    
    if (next && isPlaying) {
      ambient.play()
    } else {
      ambient.pause()
    }
  }, [musicOn, isPlaying])

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value)
    setMusicVolume(vol)
    localStorage.setItem('vesper-music-volume', String(vol))
    ambient.setVolume(vol)
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      ambient.pause()
    } else {
      audio.play().catch(() => {})
      if (musicOn) {
        ambient.play()
      }
    }
  }, [isPlaying, musicOn])

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration)
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let time = parseFloat(e.target.value)
    // For music mode, clamp seeks within the playable zone
    if (musicZone) {
      time = Math.max(musicZone.start, Math.min(time, musicZone.end - 1))
    }
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }, [musicZone])

  // handleLineClick removed — karaoke disabled; prayer JSX doesn't bind clicks.

  // For music mode, show progress within the loopable zone only
  const displayTime = musicZone
    ? Math.max(0, currentTime - musicZone.start)
    : currentTime
  const displayDuration = musicZone ? musicZone.length : duration
  const progress = displayDuration > 0 ? (displayTime / displayDuration) * 100 : 0

  return (
    <main
      className="mx-auto flex min-h-screen max-w-2xl flex-col bg-[var(--bg)] px-6 pb-8 text-[var(--text)]"
    >
      {audioPath && (
        <audio
          ref={audioRef}
          src={audioPath}
          preload="metadata"
          loop={isMusic}
          onTimeUpdate={handleTimeUpdateWithScroll}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            if (!isMusic) {
              setIsPlaying(false)
                        ambient.pause()
            }
          }}
        />
      )}

      <NavBar title={title} />

      <div className="mb-6 px-4">
        {(desc || '').split('\n\n').map((paragraph, i) => (
          <p key={i} className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
            {paragraph}
          </p>
        ))}

        {meditation.scienceUrl && (
          <a
            href={meditation.scienceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            {t.meditate.research}
          </a>
        )}
      </div>

      {!isMusic && (
        <div className="mb-5 flex justify-center gap-2">
          {baseAudioPath && (hasV2 || activeVoice === 'v1') && (
            <select
              value={activeVoice}
              onChange={(e) => handleVoiceChange(e.target.value as 'v1' | 'v2')}
              className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text)] outline-none transition-colors"
              style={{ appearance: 'none', WebkitAppearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px' }}
            >
              <option value="v1">{locale === 'fr' ? VOICES.v1.nameFr : VOICES.v1.nameEn}</option>
              {hasV2 && <option value="v2">{locale === 'fr' ? VOICES.v2.nameFr : VOICES.v2.nameEn}</option>}
            </select>
          )}
          {availableDurations.length > 0 && (
            <select
              value={selectedDuration ?? ''}
              onChange={(e) => handleDurationChange(e.target.value === '' ? null : parseInt(e.target.value))}
              className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text)] outline-none transition-colors"
              style={{ appearance: 'none', WebkitAppearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px' }}
            >
              <option value="">{t.meditate.full}</option>
              {availableDurations.map(dur => (
                <option key={dur} value={dur}>{dur} min</option>
              ))}
            </select>
          )}
        </div>
      )}

      {audioPath ? (
        <div className="mb-8 flex flex-col items-center gap-4">
          {/* Play button — ripple emission for music only */}
          <div className="relative flex items-center justify-center" style={{ overflow: 'visible' }}>
            {isMusic && <RelaxAnimation playing={isPlaying} />}
            <motion.button
              onClick={togglePlay}
              className="relative z-20 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)]"
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
            {isPlaying ? (
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 16 16" fill="var(--bg)">
                <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>
              </svg>
            ) : (
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 16 16" fill="var(--bg)">
                <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>
              </svg>
            )}
          </motion.button>
          </div>

          <div className="flex w-full max-w-sm items-center gap-3">
            <span className="w-10 text-right tabular-nums text-xs text-[var(--muted)]">
              {formatTime(displayTime)}
            </span>
            <input
              type="range"
              min={musicZone ? musicZone.start : 0}
              max={musicZone ? musicZone.end : (duration || 0)}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="vesper-seek h-11 flex-1"
              style={{ '--seek-progress': `${progress}%` } as React.CSSProperties}
              aria-label="Seek"
            />
            <span className="w-10 tabular-nums text-xs text-[var(--muted)]">
              {formatTime(displayDuration)}
            </span>
          </div>

          {/* Music control — hidden for music-only sessions */}
          {!isMusic && <div className="flex items-center justify-center gap-2.5">
            <button
              onClick={toggleMusic}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full px-2.5 py-1 transition-colors"
              style={{
                backgroundColor: musicOn ? `color-mix(in srgb, var(--accent) 12%, transparent)` : 'transparent',
                color: musicOn ? 'var(--accent)' : 'var(--muted)',
              }}
              aria-label={musicOn ? 'Disable background music' : 'Enable background music'}
            >
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13s1.12-2 2.5-2 2.5.896 2.5 2m9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2"/>
                <path fillRule="evenodd" d="M14 11V2h1v9zM6 3v10H5V3z"/>
                <path d="M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4z"/>
              </svg>
            </button>

            <input
              type="range"
              min={0}
              max={0.1}
              step={0.005}
              value={musicOn ? musicVolume : 0}
              onChange={handleVolumeChange}
              disabled={!musicOn}
              className="vesper-range h-11 w-20 transition-opacity"
              style={{ opacity: musicOn ? 1 : 0.25 }}
              aria-label="Music volume"
            />

          </div>}
        </div>
      ) : (
        <p className="mb-8 text-center text-sm text-[var(--muted)]">
          {t.meditate.audioComingSoon}
        </p>
      )}

      {/* Static prayer text for short prayers (no karaoke needed) */}
      {meditation.category === 'prayer' && script && (
        <div className="mx-auto mb-8 max-w-md px-4">
          <div className="rounded-xl bg-[var(--surface)] px-6 py-5">
            {script
              .split('\n')
              .filter(line => !/^\[\d+s\s*pause\]$/i.test(line.trim()))
              .filter(line => line.trim() !== '')
              .map((line, i) => (
                <p
                  key={i}
                  className={`text-center text-sm leading-relaxed text-[var(--text)] ${
                    line.trim().toLowerCase() === 'amen.' ? 'mt-4 font-semibold' : 'mt-2 first:mt-0'
                  }`}
                >
                  {line.trim()}
                </p>
              ))}
          </div>
        </div>
      )}

      <div className="flex-1" />
    </main>
  )
}

