import type { Locale } from '@/lib/i18n'
import { BASE } from '@/lib/constants'

interface MeditationCardProps {
  slug: string
  titleEn: string
  titleFr: string
  descEn: string
  descFr: string
  durationMin: number
  durationMinFr?: number
  isSleep?: boolean
  audioPathEn: string | null
  locale: Locale
  href?: string
  durationLabel?: string
}

export function MeditationCard({
  slug,
  titleEn,
  titleFr,
  descEn,
  descFr,
  durationMin,
  durationMinFr,
  isSleep,
  audioPathEn,
  locale,
  href,
  durationLabel = 'min',
}: MeditationCardProps) {
  const title = locale === 'fr' ? titleFr : titleEn
  const desc = locale === 'fr' ? descFr : descEn
  const resolvedHref = href ?? (isSleep ? `${BASE}/sleep/${slug}` : `${BASE}/meditate/${slug}`)

  return (
    <a
      href={resolvedHref}
      className="block rounded-xl glass-card p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-[var(--primary)]">{title}</p>
            {!!audioPathEn && (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" title="Audio available">
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="var(--accent)">
                  <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/>
                  <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z"/>
                  <path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475z"/>
                  <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06"/>
                </svg>
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">{desc}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums text-xs text-[var(--muted)]">
            {locale === 'fr' ? (durationMinFr ?? durationMin) : durationMin} {durationLabel}
          </span>
          <svg width="8" height="8" viewBox="0 0 16 16" fill="var(--muted)" className="shrink-0 opacity-40">
            <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/>
          </svg>
        </div>
      </div>
    </a>
  )
}
