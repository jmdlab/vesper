import { useState, useCallback, useEffect, useRef } from 'react'
import type { Locale } from '@/lib/i18n'

interface BibleTTSProps {
  verses: { verse: number; textEn: string; textFr: string }[]
  locale: Locale
  playing: boolean
  onComplete?: () => void
  onStop?: () => void
  onChunkChange?: (startVerse: number, endVerse: number) => void
  onStateChange?: (state: TTSState) => void
}

export type TTSState = 'idle' | 'loading-model' | 'generating' | 'playing' | 'error'

// Singleton — model loaded once, persists across navigations
let kokoroInstance: unknown = null
let kokoroLoading = false
let kokoroFailed = false

const TTS_SPEED = 0.85

export function BibleTTS({ verses, locale, playing, onComplete, onStop, onChunkChange, onStateChange }: BibleTTSProps) {
  const [state, setState] = useState<TTSState>('idle')
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const abortRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const playingRef = useRef(playing)

  // Broadcast state changes
  useEffect(function broadcastState() {
    onStateChange?.(state)
  }, [state, onStateChange])

  useEffect(() => {
    return () => {
      abortRef.current = true
      sourceRef.current?.stop()
    }
  }, [])

  // Stop on verse change
  const prevVersesRef = useRef(verses)
  useEffect(() => {
    if (prevVersesRef.current !== verses) {
      abortRef.current = true
      sourceRef.current?.stop()
      setState('idle')
      onChunkChange?.(-1, -1)
      prevVersesRef.current = verses
    }
  }, [verses, onChunkChange])

  // React to external playing toggle
  useEffect(() => {
    const wasPlaying = playingRef.current
    playingRef.current = playing

    if (playing && !wasPlaying && state === 'idle') {
      play()
    } else if (!playing && wasPlaying && (state === 'playing' || state === 'generating')) {
      stop()
    }
  }, [playing, state])

  const stop = useCallback(() => {
    abortRef.current = true
    sourceRef.current?.stop()
    window.speechSynthesis?.cancel()
    setState('idle')
    onChunkChange?.(-1, -1)
    onStop?.()
  }, [onStop, onChunkChange])

  const play = useCallback(async () => {
    if (state === 'playing' || state === 'generating') {
      stop()
      return
    }

    abortRef.current = false

    // Mobile: use native SpeechSynthesis (Kokoro's 82MB model is too heavy)
    const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    if (isMobile || kokoroFailed) {
      playWithSpeechSynthesis()
      return
    }

    try {
      // Desktop: load Kokoro model (singleton — downloads once, browser caches)
      if (!kokoroInstance && !kokoroLoading) {
        kokoroLoading = true
        setState('loading-model')

        const { KokoroTTS } = await import('kokoro-js')
        kokoroInstance = await KokoroTTS.from_pretrained(
          'onnx-community/Kokoro-82M-ONNX',
          { dtype: 'q8' }
        )
        kokoroLoading = false
      } else if (kokoroLoading) {
        setState('loading-model')
        while (kokoroLoading) {
          await new Promise(r => setTimeout(r, 200))
        }
        if (!kokoroInstance) {
          throw new Error('Model failed to load')
        }
      }

      if (abortRef.current) return

      const tts = kokoroInstance as {
        generate: (text: string, options: { voice: string; speed?: number }) => Promise<{ toBlob: () => Blob }>
      }

      // Chunk verses into segments (~500 chars each), tracking verse ranges per chunk
      const chunks: string[] = []
      const chunkVerseRanges: Array<[number, number]> = []
      let current = ''
      let chunkStartIdx = 0
      for (let vi = 0; vi < verses.length; vi++) {
        const text = locale === 'fr' ? verses[vi].textFr : verses[vi].textEn
        if (current.length + text.length > 500 && current.length > 0) {
          chunks.push(current.trim())
          chunkVerseRanges.push([chunkStartIdx, vi - 1])
          current = ''
          chunkStartIdx = vi
        }
        current += text + ' '
      }
      if (current.trim()) {
        chunks.push(current.trim())
        chunkVerseRanges.push([chunkStartIdx, verses.length - 1])
      }

      const voice = locale === 'fr' ? 'ff_siwis' : 'af_sky'

      for (let i = 0; i < chunks.length; i++) {
        if (abortRef.current) return

        setState('generating')

        const result = await tts.generate(chunks[i], { voice, speed: TTS_SPEED })
        if (abortRef.current) return

        const blob = result.toBlob()
        const arrayBuffer = await blob.arrayBuffer()

        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioContext()
        }

        const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer)
        const source = audioCtxRef.current.createBufferSource()
        source.buffer = audioBuffer
        source.connect(audioCtxRef.current.destination)
        sourceRef.current = source

        setState('playing')
        const [startIdx, endIdx] = chunkVerseRanges[i]
        onChunkChange?.(startIdx, endIdx)

        await new Promise<void>((resolve) => {
          source.onended = () => resolve()
          source.start()
        })
      }

      onChunkChange?.(-1, -1)
      setState('idle')
      onCompleteRef.current?.()
    } catch {
      kokoroFailed = true
      kokoroLoading = false
      playWithSpeechSynthesis()
    }
  }, [state, verses, locale, stop])

  const playWithSpeechSynthesis = useCallback(() => {
    const synth = window.speechSynthesis
    if (!synth) {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
      return
    }

    const verseTexts = verses.map(v => locale === 'fr' ? v.textFr : v.textEn)
    let currentVerse = 0

    function speakNext() {
      if (currentVerse >= verseTexts.length || abortRef.current) {
        setState('idle')
        if (!abortRef.current) onCompleteRef.current?.()
        return
      }

      const utterance = new SpeechSynthesisUtterance(verseTexts[currentVerse])
      utterance.lang = locale === 'fr' ? 'fr-FR' : 'en-US'
      utterance.rate = 0.85
      utterance.pitch = 1.0

      onChunkChange?.(currentVerse, currentVerse)

      utterance.addEventListener('end', () => {
        currentVerse++
        speakNext()
      })
      utterance.addEventListener('error', () => {
        currentVerse++
        speakNext()
      })

      synth.speak(utterance)
    }

    setState('playing')
    speakNext()
  }, [verses, locale, onChunkChange])

  // Headless — no visible UI
  return null
}
