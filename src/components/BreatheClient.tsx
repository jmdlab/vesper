import { useLocale } from '@/hooks/useLocale'
import { PageTransition, StaggerList, StaggerItem, FadeIn } from '@/components/Motion'
import { NavBar } from '@/components/NavBar'
import { MeditationCard } from '@/components/MeditationCard'
import type { MeditationData } from '@/types'

interface BreatheClientProps {
  protocols: MeditationData[]
}

export function BreatheClient({ protocols }: BreatheClientProps) {
  const { locale, t } = useLocale()

  const sos = protocols.filter((p) => p.slug.startsWith('sos-') && p.slug !== 'sos-nsdr')
  const nsdr = protocols.find((p) => p.slug === 'sos-nsdr')
  const breathing = protocols.filter((p) => p.slug.startsWith('breathe-'))

  return (
    <PageTransition>
      <main className="px-6 pb-8">
        <NavBar title={t.breathe.title} showBack={false} titleSize="large" />

        {sos.length > 0 && (
          <div>
            <Section title={t.breathe.sos}>
              <StaggerList className="space-y-3" role="list">
                {sos.map((p) => (
                  <StaggerItem key={p.slug} role="listitem">
                    <MeditationCard
                      slug={p.slug}
                      titleEn={p.titleEn}
                      titleFr={p.titleFr}
                      descEn={p.descEn}
                      descFr={p.descFr}
                      durationMin={p.durationMin}
                      durationMinFr={p.durationMinFr}
                      audioPathEn={p.audioPathEn}
                      locale={locale}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            </Section>
          </div>
        )}

        {nsdr && (
          <div className="stagger-item">
            <Section title={t.ui.deepRest}>
              <MeditationCard
                slug={nsdr.slug}
                titleEn={nsdr.titleEn}
                titleFr={nsdr.titleFr}
                descEn={nsdr.descEn}
                descFr={nsdr.descFr}
                durationMin={nsdr.durationMin}
                durationMinFr={nsdr.durationMinFr}
                audioPathEn={nsdr.audioPathEn}
                locale={locale}
              />
            </Section>
          </div>
        )}

        {breathing.length > 0 && (
          <div>
            <Section title={t.ui.guidedBreathing}>
              <StaggerList className="space-y-3" role="list">
                {breathing.map((p) => (
                  <StaggerItem key={p.slug} role="listitem">
                    <MeditationCard
                      slug={p.slug}
                      titleEn={p.titleEn}
                      titleFr={p.titleFr}
                      descEn={p.descEn}
                      descFr={p.descFr}
                      durationMin={p.durationMin}
                      durationMinFr={p.durationMinFr}
                      audioPathEn={p.audioPathEn}
                      locale={locale}
                    />
                  </StaggerItem>
                ))}
              </StaggerList>
            </Section>
          </div>
        )}
      </main>
    </PageTransition>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        {title}
      </h2>
      {children}
    </section>
  )
}
