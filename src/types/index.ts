import type { Locale } from '@/lib/i18n'

export interface BookWithCount {
  slug: string
  nameEn: string
  nameFr: string
  abbreviationEn: string
  abbreviationFr: string
  testament: string
  bookOrder: number
  chapterCount: number
}

export interface VerseData {
  verse: number
  textEn: string
  textFr: string
}

export interface BreathingPatternData {
  slug: string
  nameEn: string
  nameFr: string
  inhale: number
  holdIn: number
  exhale: number
  holdOut: number
  rounds: number
  sortOrder: number
}

export interface MeditationData {
  slug: string
  titleEn: string
  titleFr: string
  descEn: string
  descFr: string
  scriptEn: string
  scriptFr: string
  category: string
  durationMin: number
  durationMinFr?: number
  isSleep: boolean
  audioPathEn: string | null
  audioPathFr: string | null
  sortOrder: number
  scienceUrl: string | null
  verseRefs?: Array<{ book: string; chapter: number; verseStart: number; verseEnd: number }> | null
  breathing?: BreathingPatternData | null
  segments?: Record<string, { available: boolean; durations: number[] }>
}

export interface LocaleProps {
  locale: Locale
}
