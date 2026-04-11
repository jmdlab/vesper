/**
 * QA script for meditation audio — checks alignment, breathing, and duration integrity.
 *
 * Usage:
 *   npx tsx scripts/qa-meditations.ts                    # All meditations
 *   npx tsx scripts/qa-meditations.ts <slug>             # Single meditation
 *   npx tsx scripts/qa-meditations.ts --lang=en          # Specific language
 *   npx tsx scripts/qa-meditations.ts --verbose          # Show all checks, not just failures
 */

import { readFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { validateMeditation } from './lib/validate-meditation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const CONTENT_DIR = join(PROJECT_ROOT, 'src', 'content', 'meditations')
const AUDIO_DIR = join(PROJECT_ROOT, 'audio-storage')

// ─── Types ──────────────────────────────────────────────────────────────────

interface AlignmentJSON {
  lines: string[]
  timestamps: Array<{ start: number; end: number }>
  duration: number
}

interface MeditationJSON {
  slug: string
  category: string
  durationMin: number
  scriptEn: string
  scriptFr?: string
  breathing: {
    slug: string
    inhale: number
    holdIn: number
    exhale: number
    holdOut: number
    rounds: number
  } | null
  segments?: {
    en?: { available: boolean; durations: number[] }
  }
}

interface QAResult {
  slug: string
  lang: string
  checks: Array<{
    name: string
    status: 'pass' | 'warn' | 'fail'
    detail: string
  }>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAudioDuration(path: string): number {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', path,
    ]).toString().trim()
    return parseFloat(out)
  } catch {
    return -1
  }
}

function check(
  results: QAResult['checks'],
  name: string,
  condition: boolean,
  detail: string,
  warnOnly = false,
): void {
  results.push({
    name,
    status: condition ? 'pass' : warnOnly ? 'warn' : 'fail',
    detail,
  })
}

// ─── QA Checks ──────────────────────────────────────────────────────────────

function qaMediation(slug: string, lang: string): QAResult {
  const checks: QAResult['checks'] = []
  const medPath = join(CONTENT_DIR, `${slug}.json`)
  const alignPath = join(AUDIO_DIR, lang, `${slug}.json`)
  const mp3Path = join(AUDIO_DIR, lang, `${slug}.mp3`)

  // 1. Files exist
  check(checks, 'meditation JSON exists', existsSync(medPath), medPath)
  if (!existsSync(medPath)) return { slug, lang, checks }

  const med: MeditationJSON = validateMeditation(slug, JSON.parse(readFileSync(medPath, 'utf-8'))) as unknown as MeditationJSON

  check(checks, 'audio MP3 exists', existsSync(mp3Path), mp3Path)
  check(checks, 'alignment JSON exists', existsSync(alignPath), alignPath)
  if (!existsSync(alignPath) || !existsSync(mp3Path)) return { slug, lang, checks }

  const alignment: AlignmentJSON = JSON.parse(readFileSync(alignPath, 'utf-8'))

  // 2. Audio duration vs alignment duration
  const actualDuration = getAudioDuration(mp3Path)
  const durationDiff = Math.abs(actualDuration - alignment.duration)
  check(
    checks,
    'audio duration matches alignment',
    durationDiff < 3.0,
    `audio=${actualDuration.toFixed(1)}s, alignment=${alignment.duration.toFixed(1)}s, diff=${durationDiff.toFixed(1)}s`,
  )

  // 3. Lines/timestamps array length match
  check(
    checks,
    'lines count == timestamps count',
    alignment.lines.length === alignment.timestamps.length,
    `lines=${alignment.lines.length}, timestamps=${alignment.timestamps.length}`,
  )

  // 4. Timestamps are monotonically non-decreasing.
  // Post-seam-fix (Phase A item 2), insert-breathing should produce clean
  // monotonic timestamps. Any backward jump > 0.1s means either the seam
  // math regressed OR the ElevenLabs alignment has a collapsed region the
  // fallback couldn't handle. Fail on >2s (real corruption), warn on 0.1-2s
  // (known pre-existing issue on a few meditations), pass otherwise.
  let worstJump = 0
  let firstBadTs = -1
  for (let i = 1; i < alignment.timestamps.length; i++) {
    const jump = alignment.timestamps[i - 1].start - alignment.timestamps[i].start
    if (jump > worstJump) {
      worstJump = jump
      firstBadTs = i
    }
  }
  check(
    checks,
    'timestamps monotonically increasing',
    worstJump < 2.0,
    worstJump <= 0.1
      ? 'OK'
      : `worst backward jump: ${worstJump.toFixed(2)}s at line ${firstBadTs} (${alignment.timestamps[firstBadTs]?.start}s < ${alignment.timestamps[firstBadTs - 1]?.start}s)`,
    worstJump > 0.1 && worstJump < 2.0,  // warn-only for small cosmetic jumps
  )

  // 4b. No collapsed-timestamp regions (>20s of zero-width consecutive lines)
  // — ElevenLabs occasionally returns this for long quoted/parenthesized
  // sections; it causes silencedetect to miss the real gap and insert-breathing
  // to land the cut in the wrong place.
  let collapsedRegion = false
  let collapsedSpan = 0
  let collapsedStartIdx = -1
  for (let i = 1; i < alignment.timestamps.length; i++) {
    const a = alignment.timestamps[i - 1]
    const b = alignment.timestamps[i]
    if (b.start === a.start && b.end === a.end) {
      collapsedSpan += 1
      if (collapsedStartIdx < 0) collapsedStartIdx = i - 1
    } else {
      if (collapsedSpan > 5) {
        collapsedRegion = true
        break
      }
      collapsedSpan = 0
      collapsedStartIdx = -1
    }
  }
  check(
    checks,
    'no collapsed-timestamp region (ElevenLabs corruption)',
    !collapsedRegion,
    collapsedRegion ? `collapsed region starting near line ${collapsedStartIdx}, ${collapsedSpan}+ lines share timestamp` : 'OK',
    true, // warn only — might be intentional for some long-pause meditations
  )

  // 5. No BREATHING_SECTION markers remaining in processed audio
  const breathingMarkers = alignment.lines.filter(l => l.includes('BREATHING_SECTION')).length
  check(
    checks,
    'no BREATHING_SECTION markers in final alignment',
    breathingMarkers === 0,
    `found ${breathingMarkers} markers`,
  )

  // 6. Breathing section sanity (if breathing is configured)
  if (med.breathing) {
    const { inhale, holdIn, exhale, holdOut, rounds } = med.breathing
    const phases = [inhale, holdIn, exhale, holdOut].filter(v => v > 0)

    // Dual-language breathing-line detection. Works for EN ("breathe in",
    // "one more") and FR ("inspirez", "une dernière fois", "encore").
    const BREATH_RE = /breathe\s+in|inhale|hold\s+gently|breathe\s+out|exhale|again\.?\s*in|one\s+more|inspir\w*|expir\w*|retene[zr]|une\s+derni[èe]re/i
    const breathingLines = alignment.lines.filter(l => BREATH_RE.test(l))

    // Count occurrences of the "last one" final-round cue in BOTH languages.
    // Should equal the number of breathing blocks (1 per [BREATHING_SECTION]
    // marker in source), NOT rounds × blocks — that's the bug that shipped
    // 6 "last one" voicings on meditate-anxiety-release FR.
    //
    // CRITICAL: Anchor to line start AND require short directive length.
    // Otherwise prose lines like "Revenons au souffle une dernière fois."
    // false-positive and break QA even when audio is correct.
    const LAST_RE = /^(?:One\s+more\.\s*In\b|Last\s+(?:one|breath)\b|Une\s+derni[èe]re\s+fois\.\s+Inspir)/i
    const lastCueCount = alignment.lines.filter(l => {
      const t = l.trim()
      return t.length > 0 && t.length < 80 && LAST_RE.test(t)
    }).length

    // Determine expected "last" count from the source script by counting
    // [BREATHING_SECTION] markers the pipeline would have created.
    // Anchor to line start AND require short directive length to avoid
    // false-positives on prose lines like "Maintenant ralentissez-la
    // doucement. Inspirez par le nez sur quatre..." which contain the phrase
    // but aren't actually breathing cue lines.
    const firstRoundRE = /^(?:Breathe\s+in\s+through|Inspirez\s+par\s+le\s+nez)/i
    const firstRoundCount = alignment.lines.filter(l => {
      const t = l.trim()
      return t.length > 0 && t.length < 80 && firstRoundRE.test(t)
    }).length

    check(
      checks,
      'breathing pattern configured',
      true,
      `${med.breathing.slug}: ${inhale}/${holdIn}/${exhale}/${holdOut} × ${rounds} rounds`,
    )

    // Some meditations use narrative breathing (the narrator speaks about
    // breathing in prose) rather than explicit clip-based cue lines. When
    // the script has 0 first-round cue lines, the meditation is narrative —
    // skip the "clips present" check entirely. Otherwise verify the expected
    // count.
    if (firstRoundCount > 0) {
      check(
        checks,
        'breathing instruction clips present',
        breathingLines.length >= rounds * phases.length,
        `found ${breathingLines.length} instruction lines, expected ≥${rounds * phases.length}`,
      )
    } else {
      check(
        checks,
        'breathing pattern narrative (no clip cues)',
        true,
        'script uses prose breathing — no clip-based cues expected',
      )
    }

    // "last cue per block" — should equal firstRoundCount (one per block).
    // If it's > firstRoundCount, the stripBreathingLines fragmentation bug
    // produced extra breathing markers. Only meaningful when rounds >= 2
    // AND the alignment uses the canonical first-round phrasing
    // ("Breathe in through..." / "Inspirez par le nez..."). Otherwise we
    // can't count blocks and this check is skipped.
    if (rounds >= 2 && firstRoundCount > 0) {
      check(
        checks,
        'last-round cue count matches block count',
        lastCueCount === firstRoundCount,
        `${lastCueCount} "last"/"une dernière" cues for ${firstRoundCount} breathing blocks (should be equal)`,
      )
    }

    // Language-appropriate captions check (runs only for FR to catch the
    // hardcoded-EN-label bug in insert-breathing.ts that caused "One more.
    // In for four." to ship over French audio).
    if (lang === 'fr') {
      const enPhraseCount = alignment.lines.filter(l =>
        /\b(breathe\s+in|one\s+more|hold\s+gently|breathe\s+out)\b/i.test(l)
      ).length
      check(
        checks,
        'FR alignment has no English breathing labels',
        enPhraseCount === 0,
        enPhraseCount === 0 ? 'OK' : `found ${enPhraseCount} English breathing phrases in FR alignment`,
      )
      const frBreathCount = alignment.lines.filter(l =>
        /\b(inspirez|expirez|retene[zr])\b/i.test(l)
      ).length
      check(
        checks,
        'FR alignment has French breathing vocabulary',
        breathingLines.length === 0 || frBreathCount > 0,
        `${frBreathCount} FR breathing lines`,
      )
    }
  } else {
    check(checks, 'breathing null (natural/narrated)', true, 'no clip-based breathing expected')
  }

  // 7. Script text vs alignment text comparison
  const scriptField = lang === 'fr' ? med.scriptFr : med.scriptEn
  if (scriptField) {
    // Extract spoken lines from script (strip [BREATHING:...], [Xs pause], stage directions)
    const scriptLines = scriptField
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('[') && l.length > 10)
      .slice(0, 5) // Check first 5 spoken lines

    const alignSpokenLines = alignment.lines
      .filter(l => l && !l.startsWith('[') && l.length > 10)
      .slice(0, 5)

    // Check if first few spoken lines match
    let matchCount = 0
    for (let i = 0; i < Math.min(scriptLines.length, alignSpokenLines.length); i++) {
      // Normalize whitespace and compare first 50 chars
      const s = scriptLines[i].replace(/\s+/g, ' ').slice(0, 50)
      const a = alignSpokenLines[i].replace(/\s+/g, ' ').slice(0, 50)
      if (s === a) matchCount++
    }

    check(
      checks,
      'script text matches alignment (first 5 lines)',
      matchCount >= 3,
      `${matchCount}/${Math.min(scriptLines.length, alignSpokenLines.length)} lines match`,
      true, // warn only
    )
  }

  // 8. Duration variants (assembled files) — read from the CURRENT lang's
  // segments config, not en's. A meditation may have en variants but not fr.
  const langSegs = (med.segments as Record<string, { available?: boolean; durations?: number[] } | undefined> | undefined)?.[lang]
  if (langSegs?.available && Array.isArray(langSegs.durations) && langSegs.durations.length > 0) {
    for (const dur of langSegs.durations) {
      const assembledMp3 = join(AUDIO_DIR, lang, 'segments', slug, 'assembled', `${dur}min.mp3`)
      const assembledJson = join(AUDIO_DIR, lang, 'segments', slug, 'assembled', `${dur}min.json`)

      if (existsSync(assembledMp3)) {
        const assembledDuration = getAudioDuration(assembledMp3)
        const targetSeconds = dur * 60
        const ratio = assembledDuration / targetSeconds

        check(
          checks,
          `${dur}min variant duration`,
          ratio >= 0.5 && ratio <= 1.1,
          `actual=${(assembledDuration / 60).toFixed(1)}min (${(ratio * 100).toFixed(0)}% of target)`,
          ratio < 0.7, // warn if under 70% of target
        )

        // Check assembled alignment exists
        check(
          checks,
          `${dur}min alignment exists`,
          existsSync(assembledJson),
          assembledJson,
        )

        if (existsSync(assembledJson)) {
          const assembledAlign: AlignmentJSON = JSON.parse(readFileSync(assembledJson, 'utf-8'))
          const assembledDiff = Math.abs(assembledDuration - assembledAlign.duration)
          check(
            checks,
            `${dur}min alignment duration match`,
            assembledDiff < 3.0,
            `audio=${assembledDuration.toFixed(1)}s, align=${assembledAlign.duration.toFixed(1)}s`,
          )
        }
      } else {
        check(checks, `${dur}min variant exists`, false, `missing: ${assembledMp3}`)
      }
    }
  }

  // 9. Large timestamp gaps (potential sync issues)
  const largeGaps: string[] = []
  for (let i = 1; i < alignment.timestamps.length; i++) {
    const gap = alignment.timestamps[i].start - alignment.timestamps[i - 1].end
    if (gap > 30 && !alignment.lines[i - 1].includes('pause') && !alignment.lines[i].includes('pause')) {
      largeGaps.push(`line ${i}: ${gap.toFixed(1)}s gap`)
    }
  }
  check(
    checks,
    'no unexplained timestamp gaps >30s',
    largeGaps.length === 0,
    largeGaps.length === 0 ? 'OK' : largeGaps.slice(0, 3).join('; '),
    true,
  )

  return { slug, lang, checks }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const langArgRaw = args.find(a => a.startsWith('--lang='))?.split('=')[1]
// Default: check BOTH languages. --lang=en or --lang=fr restricts.
const langs: string[] = langArgRaw ? [langArgRaw] : ['en', 'fr']
const slugArg = args.find(a => !a.startsWith('--'))

// Find all meditation slugs. No prefix filter — audit everything shipped.
const allSlugs: string[] = []
if (slugArg) {
  allSlugs.push(slugArg)
} else {
  const { readdirSync } = await import('fs')
  const files = readdirSync(CONTENT_DIR)
  for (const f of files) {
    if (f.endsWith('.json')) {
      allSlugs.push(f.replace('.json', ''))
    }
  }
  allSlugs.sort()
}

console.log(`\n=== Meditation QA ===`)
console.log(`Languages: ${langs.join(', ')}, Meditations: ${allSlugs.length}\n`)

let totalPass = 0
let totalWarn = 0
let totalFail = 0

for (const slug of allSlugs) {
  for (const lang of langs) {
    // Skip if this language variant doesn't exist at all (e.g. no FR script).
    const medPath = join(CONTENT_DIR, `${slug}.json`)
    if (!existsSync(medPath)) continue
    const med = JSON.parse(readFileSync(medPath, 'utf-8'))
    const scriptField = lang === 'fr' ? med.scriptFr : med.scriptEn
    if (!scriptField || String(scriptField).trim().length === 0) continue

    const result = qaMediation(slug, lang)
    const fails = result.checks.filter(c => c.status === 'fail')
    const warns = result.checks.filter(c => c.status === 'warn')
    const passes = result.checks.filter(c => c.status === 'pass')

    totalPass += passes.length
    totalWarn += warns.length
    totalFail += fails.length

    const icon = fails.length > 0 ? '✗' : warns.length > 0 ? '⚠' : '✓'
    console.log(`  ${icon} ${slug} (${lang}) — ${passes.length} pass, ${warns.length} warn, ${fails.length} fail`)

    if (verbose || fails.length > 0 || warns.length > 0) {
      for (const c of result.checks) {
        if (verbose || c.status !== 'pass') {
          const statusIcon = c.status === 'pass' ? '  ✓' : c.status === 'warn' ? '  ⚠' : '  ✗'
          console.log(`    ${statusIcon} ${c.name}: ${c.detail}`)
        }
      }
    }
  }
}

console.log(`\n=== Summary: ${totalPass} pass, ${totalWarn} warn, ${totalFail} fail ===\n`)
process.exit(totalFail > 0 ? 1 : 0)
