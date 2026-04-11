/**
 * Runtime validation for meditation source JSONs.
 *
 * Not a full schema (Zod) — deliberately minimal. For 44 hand-authored files
 * with a single author, 6 typeof checks catch 100% of real-world bugs without
 * schema-library overhead. Call from every script that loads a meditation.
 */

export interface ValidatedMeditation {
  slug: string
  category: string
  durationMin: number
  scriptEn: string
  scriptFr: string
  isSleep: boolean
  breathing: {
    slug: string
    inhale: number
    holdIn: number
    exhale: number
    holdOut: number
    rounds: number
  } | null
  segments?: Record<string, { available?: boolean; durations?: number[] }>
  // other fields not validated (titleEn, verseRefs, etc) — add as needed
  [key: string]: unknown
}

export function validateMeditation(slug: string, data: unknown): ValidatedMeditation {
  const errors: string[] = []
  const m = data as Record<string, unknown>

  if (typeof m.slug !== 'string') errors.push('slug must be string')
  else if (!/^[a-z0-9-]+$/.test(m.slug)) errors.push(`slug "${m.slug}" invalid (lowercase-hyphens only)`)

  if (typeof m.category !== 'string') errors.push('category must be string')
  if (typeof m.durationMin !== 'number' || !Number.isFinite(m.durationMin) || m.durationMin <= 0) {
    errors.push('durationMin must be positive number')
  }
  if (typeof m.scriptEn !== 'string') errors.push('scriptEn must be string')
  if (typeof m.scriptFr !== 'string') errors.push('scriptFr must be string')
  if (typeof m.isSleep !== 'boolean') errors.push('isSleep must be boolean')

  if (m.breathing !== null && m.breathing !== undefined) {
    const b = m.breathing as Record<string, unknown>
    for (const k of ['inhale', 'holdIn', 'exhale', 'holdOut', 'rounds'] as const) {
      if (typeof b[k] !== 'number' || !Number.isFinite(b[k]) || (b[k] as number) < 0) {
        errors.push(`breathing.${k} must be non-negative number`)
      }
    }
    if (typeof b.slug !== 'string') errors.push('breathing.slug must be string')
    // rounds >= 1 is a hard requirement (a "breathing block" with 0 rounds is meaningless)
    if (typeof b.rounds === 'number' && b.rounds < 1) errors.push('breathing.rounds must be >= 1')
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid meditation "${slug}":\n  - ${errors.join('\n  - ')}\n` +
      `Fix src/content/meditations/${slug}.json before continuing.`
    )
  }

  return m as unknown as ValidatedMeditation
}
