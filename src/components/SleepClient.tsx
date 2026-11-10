import { useLocale } from '@/hooks/useLocale'
import { PageTransition, StaggerList, StaggerItem } from '@/components/Motion'
import { NavBar } from '@/components/NavBar'
import { MeditationCard } from '@/components/MeditationCard'
import type { MeditationData } from '@/types'

interface SleepClientProps {
  meditations: MeditationData[]
}

export function SleepClient({ meditations }: SleepClientProps) {
  const { locale, t } = useLocale()

  return (
    <PageTransition>
      <main className="min-h-screen px-6 pb-8">
        <NavBar title={t.sleep.title} showBack={false} titleSize="large" />

        {meditations.length === 0 && (
          <p className="py-16 text-center text-[var(--muted)]">
            {t.sleep.noMeditations}
          </p>
        )}

        <StaggerList className="space-y-3" role="list">
          {meditations.map((m) => (
            <StaggerItem key={m.slug} role="listitem">
              <MeditationCard
                slug={m.slug}
                titleEn={m.titleEn}
                titleFr={m.titleFr}
                descEn={m.descEn}
                descFr={m.descFr}
                durationMin={m.durationMin}
                durationMinFr={m.durationMinFr}
                isSleep
                audioPathEn={m.audioPathEn}
                locale={locale}
              />
            </StaggerItem>
          ))}
        </StaggerList>
      </main>
    </PageTransition>
  )
}
