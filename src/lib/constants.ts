/**
 * Base path for all internal links — reads from Astro/Vite's BASE_URL.
 * Resolves to '' in production (site served at the vesper.pm root, base '/');
 * overridable via the ASTRO_BASE env var at build time.
 * Trailing slash is stripped for clean path concatenation.
 */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export type BreathingPhase = 'inhale' | 'holdIn' | 'exhale' | 'holdOut'

/** ElevenLabs voice names for the narrator selector */
export const VOICES = {
  v1: { id: 'NtS6nEHDYMQC9QczMQuq', nameEn: 'Katherine', nameFr: 'Koraly' },
  v2: { id: 'EkK5I93UQWFDigLMpZcX', nameEn: 'James', nameFr: 'James' },
} as const

/** Meditation category identifiers */
export const CATEGORIES = {
  morning: 'morning',
  anxiety: 'anxiety',
  selfCompassion: 'self-compassion',
  contemplative: 'contemplative',
  sleep: 'sleep',
  sos: 'sos',
  prayer: 'prayer',
  music: 'music',
} as const

export type Category = (typeof CATEGORIES)[keyof typeof CATEGORIES]

/** Category display labels by locale */
export const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  en: {
    all: 'All',
    [CATEGORIES.morning]: 'Morning',
    [CATEGORIES.anxiety]: 'Anxiety',
    [CATEGORIES.selfCompassion]: 'Self-Compassion',
    [CATEGORIES.contemplative]: 'Contemplative',
    [CATEGORIES.sleep]: 'Sleep',
    [CATEGORIES.sos]: 'SOS',
    [CATEGORIES.prayer]: 'Prayer',
    [CATEGORIES.music]: 'Music',
  },
  fr: {
    all: 'Toutes',
    [CATEGORIES.morning]: 'Matin',
    [CATEGORIES.anxiety]: 'Anxiété',
    [CATEGORIES.selfCompassion]: 'Bienveillance',
    [CATEGORIES.contemplative]: 'Contemplative',
    [CATEGORIES.sleep]: 'Sommeil',
    [CATEGORIES.sos]: 'SOS',
    [CATEGORIES.prayer]: 'Prière',
    [CATEGORIES.music]: 'Musique',
  },
}

/** Filter tabs for the meditate page */
export const MEDITATE_FILTERS = [
  'all',
  CATEGORIES.morning,
  CATEGORIES.anxiety,
  CATEGORIES.selfCompassion,
  CATEGORIES.contemplative,
  CATEGORIES.music,
] as const

export type MeditateFilter = (typeof MEDITATE_FILTERS)[number]
