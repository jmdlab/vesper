import { defineCollection, z } from 'astro:content'

const meditations = defineCollection({
  type: 'data',
  schema: z.object({
    slug: z.string(),
    titleEn: z.string(),
    titleFr: z.string(),
    descEn: z.string(),
    descFr: z.string(),
    scriptEn: z.string(),
    scriptFr: z.string(),
    category: z.string(),
    durationMin: z.number(),
    durationMinFr: z.number().optional(),
    isSleep: z.boolean(),
    verseRefs: z.unknown().nullable(),
    audioPathEn: z.string().nullable(),
    audioPathFr: z.string().nullable(),
    sortOrder: z.number(),
    breathing: z.object({
      slug: z.string(),
      nameEn: z.string(),
      nameFr: z.string(),
      inhale: z.number(),
      holdIn: z.number(),
      exhale: z.number(),
      holdOut: z.number(),
      rounds: z.number(),
    }).nullable(),
  }),
})

const breathing = defineCollection({
  type: 'data',
  schema: z.object({
    slug: z.string(),
    nameEn: z.string(),
    nameFr: z.string(),
    inhale: z.number(),
    holdIn: z.number(),
    exhale: z.number(),
    holdOut: z.number(),
    rounds: z.number(),
    sortOrder: z.number(),
  }),
})

export const collections = { meditations, breathing }
