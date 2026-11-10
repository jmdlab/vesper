/**
 * Deploy step 3 (audit 10/11/2026 W5): copy audio-storage/<lang> to the served audio tree. Returns the failures instead of
 * swallowing them, so `pipeline.ts deploy` can exit non-zero: an EACCES on a root-owned audio dir used to print one
 * line and still end on "Deploy complete!", leaving stale audio and transcripts live.
 */
import { existsSync, mkdirSync, readdirSync, cpSync } from 'fs'
import { join } from 'path'

export function copyAudio(srcRoot: string, destRoot: string, langs: string[], log = console.log): string[] {
  const failures: string[] = []
  for (const lang of langs) {
    const src = join(srcRoot, lang)
    if (!existsSync(src)) continue
    const dest = join(destRoot, lang)
    try {
      if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
      cpSync(src, dest, { recursive: true })
      const audioCount = readdirSync(src).filter(f => f.endsWith('.mp3')).length
      const segDir = join(src, 'segments')
      const segCount = existsSync(segDir) ? readdirSync(segDir).length : 0
      log(`   ${lang}: ${audioCount} audio files${segCount ? `, ${segCount} segmented meditations` : ''} copied`)
    } catch (e) {
      failures.push(`${lang}: ${(e as Error).message}`)
    }
  }
  return failures
}
