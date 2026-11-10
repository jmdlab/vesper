import { useLocale } from '@/hooks/useLocale'
import { NavBar } from '@/components/NavBar'
import { BASE, CATEGORY_LABELS } from '@/lib/constants'
import { parseScript } from '@/lib/parseScript'
import type { MeditationData } from '@/types'

interface MeditationReaderProps {
  meditation: MeditationData
}

export function MeditationReader({ meditation }: MeditationReaderProps) {
  const { locale, t } = useLocale()

  const title = locale === 'fr' ? meditation.titleFr : meditation.titleEn
  const desc = locale === 'fr' ? meditation.descFr : meditation.descEn
  const script = locale === 'fr' ? meditation.scriptFr : meditation.scriptEn
  const catLabel = (CATEGORY_LABELS[locale] ?? CATEGORY_LABELS.en)[meditation.category] ?? meditation.category
  const lines = parseScript(script)

  return (
    <main className="px-6 pb-16">
      <NavBar title={title} />

      <div className="mb-8">
        <p className="mt-3 leading-relaxed text-[var(--muted)]">{desc}</p>
        <div className="mt-4 flex items-center gap-3">
          <span className="tabular-nums text-xs text-[var(--muted)]">
            {locale === 'fr' ? (meditation.durationMinFr ?? meditation.durationMin) : meditation.durationMin} {t.meditate.duration}
          </span>
          <span className="rounded-full bg-[var(--surface)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
            {catLabel}
          </span>
        </div>
      </div>

      {meditation.breathing && (
        <a
          href={`${BASE}/breathe/${meditation.breathing.slug}`}
          className="mb-10 flex items-center gap-3 rounded-xl border border-[var(--border)] p-4 transition-colors hover:bg-[var(--surface)]"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 16 16" fill="var(--accent)">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
          </svg>
          <span className="text-sm text-[var(--accent)]">{t.meditate.beginBreathing}</span>
        </a>
      )}

      <article className="mx-auto max-w-prose space-y-6">
        {lines.map((line, i) => {
          if (line.type === 'pause') return null
          if (line.type === 'stage-direction') {
            return (
              <p key={i} className="text-xs italic leading-relaxed text-[var(--muted)]">
                {line.text}
              </p>
            )
          }
          if (line.type === 'scripture') {
            return (
              <p
                key={i}
                className="font-[family-name:var(--font-serif)] text-xl leading-[1.8] text-[var(--accent)]"
              >
                {line.text}
              </p>
            )
          }
          return (
            <p key={i} className="leading-[1.8] text-[var(--text)]">
              {line.text}
            </p>
          )
        })}
      </article>
    </main>
  )
}
