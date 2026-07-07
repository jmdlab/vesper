import { useState } from 'react'
import { useLocale } from '@/hooks/useLocale'
import { PageTransition, StaggerList, StaggerItem, TabContent } from '@/components/Motion'
import { NavBar } from '@/components/NavBar'
import { MeditationCard } from '@/components/MeditationCard'
import { MEDITATE_FILTERS, CATEGORY_LABELS } from '@/lib/constants'
import type { MeditateFilter } from '@/lib/constants'
import type { MeditationData } from '@/types'

interface MeditateClientProps {
  meditations: MeditationData[]
}

export function MeditateClient({ meditations }: MeditateClientProps) {
  const { locale, t } = useLocale()
  const [activeCategory, setActiveCategory] = useState<MeditateFilter>('all')

  const handleFilter = (cat: MeditateFilter) => {
    setActiveCategory(cat)
  }

  const filtered = activeCategory === 'all'
    ? meditations
    : meditations.filter((m) => m.category === activeCategory)

  const labels = CATEGORY_LABELS[locale] ?? CATEGORY_LABELS.en

  return (
    <PageTransition>
      <main className="px-6 pb-8">
        <NavBar title={t.meditate.title} showBack={false} titleSize="large" />

        <nav className="mb-6 flex gap-2 overflow-x-auto overscroll-x-contain scroll-snap-x pb-1 scrollbar-hide" aria-label="Filter meditations">
          {MEDITATE_FILTERS.map((cat) => (
            <button
              key={cat}
              onClick={() => handleFilter(cat)}
              aria-pressed={activeCategory === cat}
              className={`shrink-0 snap-start rounded-full px-4 py-3 text-sm transition-colors ${
                activeCategory === cat
                  ? 'bg-[var(--accent)] text-[var(--bg)]'
                  : 'border border-[var(--border)] text-[var(--muted)] hover:text-[var(--primary)]'
              }`}
            >
              {labels[cat]}
            </button>
          ))}
        </nav>

        {filtered.length === 0 && (
          <p className="py-16 text-center text-[var(--muted)]">
            {t.meditate.noMeditations}
          </p>
        )}

        <TabContent id={activeCategory}>
          <StaggerList className="space-y-3" role="list">
            {filtered.map((m) => (
              <StaggerItem key={m.slug} role="listitem">
                <MeditationCard
                  slug={m.slug}
                  titleEn={m.titleEn}
                  titleFr={m.titleFr}
                  descEn={m.descEn}
                  descFr={m.descFr}
                  durationMin={m.durationMin}
                  audioPathEn={m.audioPathEn}
                  locale={locale}
                  durationLabel={t.meditate.duration}
                />
              </StaggerItem>
            ))}
          </StaggerList>
        </TabContent>
      </main>
    </PageTransition>
  )
}
