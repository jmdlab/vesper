import { useState, useMemo } from 'react'
import { useLocale } from '@/hooks/useLocale'
import { BASE, CATEGORIES } from '@/lib/constants'
import { PageTransition, StaggerList, StaggerItem, FadeIn } from '@/components/Motion'
import { getDailyVerse } from '@/lib/daily-verses'
import { getLiturgicalContext } from '@/lib/liturgical-context'

interface Meditation {
  slug: string
  titleEn: string
  titleFr: string
  descEn: string
  descFr: string
  durationMin: number
  durationMinFr?: number
  isSleep: boolean
  category: string
  audioPathEn: string | null
}

interface HomeClientProps {
  allMeditations: Meditation[]
  readingLabel?: string
  readingLabelFr?: string
  readingReason?: string
  readingReasonFr?: string
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening'

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 20) return 'afternoon'
  return 'evening'
}

function getDayOfYear(): number {
  const today = new Date()
  return Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  )
}

function pickThree<T>(items: T[], seed: number): T[] {
  if (items.length <= 3) return items
  const start = seed % items.length
  const result: T[] = []
  for (let i = 0; i < 3; i++) {
    result.push(items[(start + i) % items.length])
  }
  return result
}

const GREETINGS: Record<string, Record<TimeOfDay, string>> = {
  en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
  fr: { morning: 'Bonjour', afternoon: 'Bon après-midi', evening: 'Bonsoir' },
}

const SECTION_CONFIG: Record<TimeOfDay, { primary: 'morning' | 'meditate' | 'sleep'; label: Record<string, string>; href: string }> = {
  morning: { primary: 'morning', label: { en: 'Start your day', fr: 'Commencer la journée' }, href: `${BASE}/meditate` },
  afternoon: { primary: 'meditate', label: { en: 'Midday pause', fr: 'Pause de midi' }, href: `${BASE}/meditate` },
  evening: { primary: 'sleep', label: { en: 'Wind down', fr: 'Se détendre' }, href: `${BASE}/sleep` },
}

function CategoryIcon({ category }: { category: string }) {
  const p = { 'aria-hidden': true, className: 'shrink-0', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor' } as const
  switch (category) {
    case CATEGORIES.morning:
      // Sunrise
      return <svg {...p}><path d="M7.646 1.146a.5.5 0 0 1 .708 0l1.5 1.5a.5.5 0 0 1-.708.708L8.5 2.707V4.5a.5.5 0 0 1-1 0V2.707l-.646.647a.5.5 0 1 1-.708-.708zM2.343 4.343a.5.5 0 0 1 .707 0l1.414 1.414a.5.5 0 0 1-.707.707L2.343 5.05a.5.5 0 0 1 0-.707m11.314 0a.5.5 0 0 1 0 .707l-1.414 1.414a.5.5 0 1 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0M8 7a3 3 0 0 1 2.599 4.5H5.4A3 3 0 0 1 8 7m3.71 4.5a4 4 0 1 0-7.418 0H.499a.5.5 0 0 0 0 1h15a.5.5 0 0 0 0-1h-3.79zM0 10a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2A.5.5 0 0 1 0 10m13 0a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5" /></svg>
    case CATEGORIES.sleep:
      // Moon
      return <svg {...p}><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278M4.858 1.311A7.27 7.27 0 0 0 1.025 7.71c0 4.02 3.279 7.276 7.319 7.276a7.32 7.32 0 0 0 5.205-2.162q-.506.063-1.029.063c-4.61 0-8.343-3.714-8.343-8.29 0-1.167.242-2.278.681-3.286" /></svg>
    case CATEGORIES.anxiety:
      // Shield check
      return <svg {...p}><path d="M5.338 1.59a61 61 0 0 0-2.837.856.48.48 0 0 0-.328.39c-.554 4.157.726 7.19 2.253 9.188a10.7 10.7 0 0 0 2.287 2.233c.346.244.652.42.893.533q.18.085.293.118a1 1 0 0 0 .101.025 1 1 0 0 0 .1-.025q.114-.034.294-.118c.24-.113.547-.29.893-.533a10.7 10.7 0 0 0 2.287-2.233c1.527-1.997 2.807-5.031 2.253-9.188a.48.48 0 0 0-.328-.39c-.651-.213-1.75-.56-2.837-.855C9.552 1.29 8.531 1.067 8 1.067c-.53 0-1.552.223-2.662.524zM5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.8 11.8 0 0 1-2.517 2.453 7 7 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7 7 0 0 1-1.048-.625 11.8 11.8 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 63 63 0 0 1 5.072.56" /><path d="M10.854 5.146a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7.5 7.793l2.646-2.647a.5.5 0 0 1 .708 0" /></svg>
    case CATEGORIES.selfCompassion:
      // Gift
      return <svg {...p}><path d="M3 2.5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0v.006c0 .07 0 .27-.038.494H15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 14.5V7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2.038A3 3 0 0 1 3 2.506zm1.068.5H7v-.5a1.5 1.5 0 1 0-3 0c0 .085.002.274.045.43zM9 3h2.932l.023-.07c.043-.156.045-.345.045-.43a1.5 1.5 0 0 0-3 0zM1 4v2h6V4zm8 0v2h6V4zm5 3H9v8h4.5a.5.5 0 0 0 .5-.5zm-7 8V7H2v7.5a.5.5 0 0 0 .5.5z" /></svg>
    case CATEGORIES.contemplative:
      // Feather
      return <svg {...p}><path d="M15.807.531c-.174-.177-.41-.289-.64-.363a3.8 3.8 0 0 0-.833-.15c-.62-.049-1.394 0-2.252.175C10.365.545 8.264 1.415 6.315 3.1S3.147 6.824 2.557 8.523c-.294.847-.44 1.634-.429 2.268.005.316.05.62.154.88q.025.061.056.122A68 68 0 0 0 .08 15.198a.53.53 0 0 0 .157.72.504.504 0 0 0 .705-.16 68 68 0 0 1 2.158-3.26c.285.141.616.195.958.182.513-.02 1.098-.188 1.723-.49 1.25-.605 2.744-1.787 4.303-3.642l1.518-1.55a.53.53 0 0 0 0-.739l-.729-.744 1.311.209a.5.5 0 0 0 .443-.15l.663-.684c.663-.68 1.292-1.325 1.763-1.892.314-.378.585-.752.754-1.107.163-.345.278-.773.112-1.188a.5.5 0 0 0-.112-.172M3.733 11.62C5.385 9.374 7.24 7.215 9.309 5.394l1.21 1.234-1.171 1.196-.027.03c-1.5 1.789-2.891 2.867-3.977 3.393-.544.263-.99.378-1.324.39a1.3 1.3 0 0 1-.287-.018Zm6.769-7.22c1.31-1.028 2.7-1.914 4.172-2.6a7 7 0 0 1-.4.523c-.442.533-1.028 1.134-1.681 1.804l-.51.524zm3.346-3.357C9.594 3.147 6.045 6.8 3.149 10.678c.007-.464.121-1.086.37-1.806.533-1.535 1.65-3.415 3.455-4.976 1.807-1.561 3.746-2.36 5.31-2.68a8 8 0 0 1 1.564-.173" /></svg>
    case CATEGORIES.sos:
      // Lightning
      return <svg {...p}><path d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9.5H3.5a.5.5 0 0 1-.48-.641z" /></svg>
    case CATEGORIES.prayer:
      // Fire
      return <svg {...p}><path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16m0-1c-1.657 0-3-1-3-2.75 0-.75.25-2 1.25-3C6.125 10 7 10.5 7 10.5c-.375-1.25.5-3.25 2-3.5-.179 1-.25 2 1 3 .625.5 1 1.364 1 2.25C11 14 9.657 15 8 15" /></svg>
    case CATEGORIES.music:
      // Music note beamed
      return <svg {...p}><path d="M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13s1.12-2 2.5-2 2.5.896 2.5 2m9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2" /><path fillRule="evenodd" d="M14 11V2h1v9zM6 3v10H5V3z" /><path d="M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4z" /></svg>
    default:
      // Stars
      return <svg {...p}><path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z" /></svg>
  }
}

function MeditationRow({ m, locale, isSleep }: { m: Meditation; locale: string; isSleep?: boolean }) {
  const title = locale === 'fr' ? m.titleFr : m.titleEn
  const desc = locale === 'fr' ? m.descFr : m.descEn
  const href = isSleep ? `${BASE}/sleep/${m.slug}` : `${BASE}/meditate/${m.slug}`

  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4 transition-colors hover:bg-[var(--surface)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--accent)]">
        <CategoryIcon category={m.category} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--primary)]">{title}</p>
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{desc}</p>
      </div>
      <span className="shrink-0 tabular-nums text-xs text-[var(--muted)]">
        {locale === 'fr' ? (m.durationMinFr ?? m.durationMin) : m.durationMin} min
      </span>
    </a>
  )
}

export function HomeClient({ allMeditations, readingLabel, readingLabelFr, readingReason, readingReasonFr }: HomeClientProps) {
  const { locale, t } = useLocale()
  const [timeOfDay] = useState<TimeOfDay>(getTimeOfDay)

  const dayOfYear = getDayOfYear()
  const dailyVerse = useMemo(() => getDailyVerse(), [])
  const liturgy = useMemo(() => getLiturgicalContext(), [])

  const featured = useMemo(() => {
    const morning = allMeditations.filter((m) => m.category === CATEGORIES.morning)
    const meditate = allMeditations.filter((m) =>
      ([CATEGORIES.anxiety, CATEGORIES.selfCompassion, CATEGORIES.contemplative] as string[]).includes(m.category) && !m.isSleep
    )
    const sleep = allMeditations.filter((m) => m.isSleep)
    const prayers = allMeditations.filter((m) => m.category === CATEGORIES.prayer)

    return {
      morning: pickThree(morning, dayOfYear),
      meditate: pickThree(meditate, dayOfYear + 7),
      sleep: pickThree(sleep, dayOfYear + 13),
      prayers: pickThree(prayers, dayOfYear),
    }
  }, [allMeditations, dayOfYear])

  const config = SECTION_CONFIG[timeOfDay]
  const greetings = GREETINGS[locale] ?? GREETINGS.en
  const primaryItems = featured[config.primary]

  return (
    <PageTransition>
      <main className="px-6 pb-8" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <header className="mb-10">
          <h1 className="font-[family-name:var(--font-serif)] text-3xl font-semibold text-[var(--primary)]">
            {greetings[timeOfDay]}
          </h1>
        </header>

        {/* Daily verse */}
        <FadeIn>
          <section className="mb-10">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t.bible.verseOfTheDay}
            </h2>
            <a
              href={`${BASE}/bible`}
              className="block rounded-xl glass-surface p-5 transition-colors hover:bg-[var(--surface)]"
            >
              <p className="font-[family-name:var(--font-serif)] text-xl leading-relaxed text-[var(--primary)]">
                &ldquo;{locale === 'fr' ? dailyVerse.textFr : dailyVerse.textEn}&rdquo;
              </p>
              <footer className="mt-3 text-sm text-[var(--muted)]">
                {locale === 'fr' ? dailyVerse.referenceFr : dailyVerse.reference}
              </footer>
              <div className="mt-2 flex justify-end">
                <span className="text-xs font-medium text-[var(--accent)]">
                  {t.bible.openBible} →
                </span>
              </div>
            </a>

            {/* Liturgical context */}
            <a
              href={`${BASE}/today`}
              className="mt-4 block rounded-xl glass-surface px-4 py-3 transition-colors hover:bg-[var(--surface)]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--accent)]">
                  {locale === 'fr' ? liturgy.current.nameFr : liturgy.current.name}
                </p>
                {liturgy.seasonDay != null && liturgy.seasonTotal != null && (
                  <p className="shrink-0 tabular-nums text-xs text-[var(--muted)]">
                    {locale === 'fr'
                      ? `Jour ${liturgy.seasonDay} / ${liturgy.seasonTotal}`
                      : `Day ${liturgy.seasonDay} / ${liturgy.seasonTotal}`}
                  </p>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
                {locale === 'fr' ? liturgy.current.descriptionFr : liturgy.current.description}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                {liturgy.upcoming ? (
                  <p className="text-xs text-[var(--accent)]">
                    {locale === 'fr'
                      ? `${liturgy.upcoming.nameFr} dans ${liturgy.upcoming.daysUntil === 1 ? 'un jour' : `${liturgy.upcoming.daysUntil} jours`}`
                      : `${liturgy.upcoming.name} in ${liturgy.upcoming.daysUntil === 1 ? '1 day' : `${liturgy.upcoming.daysUntil} days`}`}
                  </p>
                ) : <span />}
                <span className="text-xs font-medium text-[var(--accent)]">
                  {t.home.learnMore} →
                </span>
              </div>
            </a>
          </section>
        </FadeIn>

        {/* Time-appropriate featured section */}
        {primaryItems.length > 0 && (
          <FadeIn delay={0.1}>
            <section className="mb-10">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  {config.label[locale] ?? config.label.en}
                </h2>
                <a
                  href={config.href}
                  className="min-h-[44px] flex items-center text-xs text-[var(--accent)] hover:underline"
                >
                  {t.home.seeAll}
                </a>
              </div>
              <StaggerList className="space-y-2" role="list">
                {primaryItems.map((m) => (
                  <StaggerItem key={m.slug} role="listitem">
                    <MeditationRow m={m} locale={locale} isSleep={m.isSleep} />
                  </StaggerItem>
                ))}
              </StaggerList>
            </section>
          </FadeIn>
        )}

        {/* Prayers */}
        {featured.prayers.length > 0 && (
          <FadeIn delay={0.2}>
            <section className="mb-10">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                {t.home.prayers}
              </h2>
              <StaggerList className="space-y-2" role="list">
                {featured.prayers.map((m) => (
                  <StaggerItem key={m.slug} role="listitem">
                    <MeditationRow m={m} locale={locale} />
                  </StaggerItem>
                ))}
              </StaggerList>
            </section>
          </FadeIn>
        )}

      </main>
    </PageTransition>
  )
}
