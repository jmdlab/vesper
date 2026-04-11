/**
 * TTS text preparation — transforms raw meditation scripts into
 * ElevenLabs v3-ready text with [long pause] / [short pause] audio tags.
 *
 * This is DIFFERENT from src/lib/parseScript.ts which is for display rendering.
 * This version adds pacing pauses, strips stage directions, and handles
 * breathing instructions for the TTS engine.
 */

/** Pacing config per category — controls pause density */
export const PACING = {
  sleep:    { sentencePause: '', questionPause: '', ellipsisPause: '', paragraphPauses: 2 },
  meditate: { sentencePause: '', questionPause: '', ellipsisPause: '', paragraphPauses: 1 },
  morning:  { sentencePause: '', questionPause: '', ellipsisPause: '', paragraphPauses: 1 },
  sos:      { sentencePause: '', questionPause: '', ellipsisPause: '', paragraphPauses: 1 },
  prayer:   { sentencePause: '', questionPause: '', ellipsisPause: '', paragraphPauses: 0 },
} as const

/** Voice settings per category for ElevenLabs */
export const VOICE_SETTINGS = {
  sleep: {
    stability: 0.80,
    similarity_boost: 0.75,
    style: 0.05,
    use_speaker_boost: true,
    speed: 0.70,
  },
  meditate: {
    stability: 0.70,
    similarity_boost: 0.75,
    style: 0.12,
    use_speaker_boost: true,
    speed: 0.70,
  },
  morning: {
    stability: 0.60,
    similarity_boost: 0.75,
    style: 0.20,
    use_speaker_boost: true,
    speed: 0.70,
  },
  sos: {
    stability: 0.60,
    similarity_boost: 0.75,
    style: 0.15,
    use_speaker_boost: true,
    speed: 0.75,
  },
  prayer: {
    stability: 0.75,
    similarity_boost: 0.75,
    style: 0.10,
    use_speaker_boost: true,
    speed: 0.70,
  },
} as const

/** Pause multiplier — scales written pause durations per category */
export function getPauseMultiplier(category: string): number {
  if (category === 'morning' || category === 'sos') return 0.3
  if (category === 'sleep') return 0.7
  return 0.5
}

/** Build a v3 pause from chained [long pause] / [short pause] tags */
export function v3Pause(count: number, type: 'long' | 'short' = 'long'): string {
  if (count <= 0) return ''
  return Array(count).fill(`[${type} pause]`).join(' ')
}

/** Convert a pause descriptor like "long long" into chained tags */
export function v3PauseFromDesc(desc: string): string {
  const parts = desc.split(' ')
  return parts.map(p => `[${p} pause]`).join(' ')
}

/** Get voice settings for a category */
export function getVoiceSettings(category: string): Record<string, unknown> {
  if (category === 'sleep') return { ...VOICE_SETTINGS.sleep }
  if (category === 'morning') return { ...VOICE_SETTINGS.morning }
  if (category === 'sos') return { ...VOICE_SETTINGS.sos }
  if (category === 'prayer') return { ...VOICE_SETTINGS.prayer }
  return { ...VOICE_SETTINGS.meditate }
}

/**
 * Detect and strip breathing counting lines from the raw script.
 *
 * Counting lines look like: "Breathe in... one... two... three... four."
 * or abbreviated: "In... two... three... four.", "Hold... two... three..."
 *
 * Returns the script with breathing lines replaced by [BREATHING_SECTION]
 * marker, which insert-breathing.ts later replaces with clip-based audio.
 */
export function stripBreathingLines(raw: string): string {
  const lines = raw.split('\n')
  // Counting pattern: lines like "In... two... three... four" — must have ellipsis-separated numbers
  // First number must be one/two (ascending start) to exclude PMR countdowns (five... four... three...)
  const countingPattern = /\.\.\.\s*(?:one|two|un|deux)\b.*\.\.\.\s*(?:two|three|four|five|six|seven|eight|deux|trois|quatre|cinq|six|sept|huit)\b/i

  // Breathing instruction: short directive lines that are phase cues.
  //
  // EN patterns (all include the phase verb so prayer refrains like
  // "Again. I am yours." never match):
  //   Breathe in…, In for four, Out for four, Hold (for|gently for)…,
  //   Again. In for…, One more. In for…, Exhale slowly…, And hold for…
  //
  // FR patterns (same principle — lead-in is optional but a phase verb is
  // REQUIRED after it, so non-breathing lines like
  // "Encore. « Je suis à toi. »" and "Une dernière fois. Pas plus fort."
  // are not captured). Accepted phase verbs: Inspir…, Expir…, Reten…
  // Accepted separators between verb and its argument: whitespace OR ellipsis
  // (so "Inspirez..." with trailing dots also matches).
  // Alternative #1: EN with lead-in. "Again. " or "One more. " followed by any
  // EN phase verb INCLUDING bare "In" (the context resolves the ambiguity;
  // bare "In" alone is too loose for false-positives like "In this moment").
  const enLeadIn  = '(?:Again|One\\s+more)\\.\\s+(?:Breathe\\s+in\\b|Breathe\\s+out\\b|Inhale\\b|Exhale\\b|Hold\\b|In\\b|Out\\b)'

  // Alternative #2: EN direct (no lead-in). Bare "In" NOT allowed; "In for X"
  // and "Out for X" only, Hold must be followed by "for" or "gently".
  const enDirect  = '(?:Breathe\\s+in\\b|Breathe\\s+out\\b|Inhale\\b|Exhale\\b|Hold\\s+(?:for|gently)\\b|And\\s+hold\\b|In\\s+for\\s+\\w+|Out\\s+for\\s+\\w+)'

  // Alternative #3: FR. Optional lead-in ("Et ", "Encore. ", "Une dernière
  // fois. ") followed by a strict imperative phase verb. We require the
  // imperative form (Inspirez/Expirez/Retenez) to avoid catching prose like
  // "L'inspiration vient de Dieu" or "Inspiré par le Seigneur".
  const frPattern = '(?:(?:Et|Encore\\.|Une\\s+derni[èe]re\\s+fois\\.)\\s+)?(?:Inspirez|Expirez|Retenez)\\b'

  const breathingInstrPattern = new RegExp(
    `^(?:${enLeadIn}|${enDirect}|${frPattern})`,
    'i',
  )
  const pausePattern = /^\[\d+s?\s+(?:pause|silence)/i

  // Find ALL breathing sections
  const sections: Array<{ start: number; end: number }> = []
  let inBreathingSection = false
  let sectionStart = -1
  let sectionEnd = -1

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    const isCounting = trimmed ? countingPattern.test(trimmed) : false
    const isBreathingInstr = trimmed ? breathingInstrPattern.test(trimmed) : false
    const isPause = trimmed ? pausePattern.test(trimmed) : false

    if ((isCounting || isBreathingInstr) && !inBreathingSection) {
      inBreathingSection = true
      sectionStart = i
      sectionEnd = i
    }

    if (inBreathingSection) {
      if (isCounting || isBreathingInstr || isPause || !trimmed) {
        sectionEnd = i
      } else {
        // Non-breathing line — save this section and reset
        sections.push({ start: sectionStart, end: sectionEnd })
        inBreathingSection = false
        sectionStart = -1
        sectionEnd = -1
      }
    }
  }

  // Don't forget the last section if script ends with breathing
  if (inBreathingSection && sectionStart >= 0) {
    sections.push({ start: sectionStart, end: sectionEnd })
  }

  if (sections.length === 0) return raw

  // Replace sections from end to start to preserve indices
  const result = [...lines]
  for (let s = sections.length - 1; s >= 0; s--) {
    const { start, end } = sections[s]
    result.splice(start, end - start + 1, '', '[BREATHING_SECTION]', '')
  }

  return result.join('\n')
}

/**
 * Transform raw meditation script into TTS-ready text with v3 audio tag pauses.
 *
 * This function:
 * 1. Strips breathing instructions [BREATHING: ...]
 * 2. Strips breathing counting lines (replaced by [BREATHING_SECTION] marker)
 * 3. Converts timed pauses [15s pause] to chained [long pause] tags
 * 4. Strips pure stage directions [...]
 * 5. Strips inline stage directions within spoken text
 * 6. Adds sentence-level pauses after periods, questions, and ellipses
 * 7. Converts paragraph breaks to chained pause tags
 */
export function prepareScript(raw: string, category: string, hasBreathing = true): string {
  // Strip breathing counting lines ONLY if the meditation has a breathing
  // config. When breathing is null, the narrator speaks the breathing
  // instructions naturally — stripping them would emit [BREATHING_SECTION]
  // markers that insert-breathing.ts won't process (since there's no config),
  // and the markers would ship as literal TTS output ("breathing section").
  const stripped = hasBreathing ? stripBreathingLines(raw) : raw
  const pauseMult = getPauseMultiplier(category)
  const lines = stripped.split('\n')
  const output: string[] = []

  // Resolve pacing — use category-specific or fall back to meditate
  const pacingKey = category as keyof typeof PACING
  const pacing = PACING[pacingKey] ?? PACING.meditate

  for (const line of lines) {
    const trimmed = line.trim()

    // Empty line = paragraph break
    if (!trimmed) {
      output.push(v3Pause(pacing.paragraphPauses, 'long'))
      continue
    }

    // Skip breathing instructions
    if (/^\[BREATHING:/.test(trimmed) || /^\[RESPIRATION\s*:/.test(trimmed)) continue

    // Breathing section marker → short silence (clip-based breathing inserted in post-processing)
    if (trimmed === '[BREATHING_SECTION]') {
      output.push('[BREATHING_SECTION]')
      continue
    }

    // Timed pause: [15s pause], [20s silence], etc.
    const timedPause = trimmed.match(/^\[(\d+)s?\s+(?:pause|silence|de pause|de silence).*\]$/i)
    if (timedPause) {
      const seconds = Math.max(1, Math.round(parseInt(timedPause[1]) * pauseMult))
      // ~3s per [long pause], chain as needed
      const longCount = Math.max(1, Math.round(seconds / 3))
      output.push(v3Pause(longCount, 'long'))
      continue
    }

    // Generic [pause] / [silence]
    if (/^\[(pause|silence)\]$/i.test(trimmed)) {
      output.push(v3Pause(Math.max(1, Math.round(3 * pauseMult / 3)), 'long'))
      continue
    }

    // Pure stage direction — skip
    if (/^\[.*\]$/.test(trimmed)) continue

    // Strip inline stage directions
    let cleaned = trimmed.replace(/\[[^\]]+\]/g, '').trim()

    // Add sentence-level pauses using v3 audio tags (only if configured)
    if (pacing.ellipsisPause) {
      cleaned = cleaned.replace(/\.\.\.\s*/g, `... ${v3PauseFromDesc(pacing.ellipsisPause)} `)
    }
    if (pacing.sentencePause) {
      cleaned = cleaned.replace(/\.\s+/g, `. ${v3PauseFromDesc(pacing.sentencePause)} `)
    }
    if (pacing.questionPause) {
      cleaned = cleaned.replace(/\?\s+/g, `? ${v3PauseFromDesc(pacing.questionPause)} `)
    }

    // Clean up multiple spaces
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()

    if (cleaned) {
      output.push(cleaned)
    }
  }

  return output.join('\n').trim()
}

/**
 * Split text at natural boundaries if over the char limit.
 * ElevenLabs v3 has a ~5000 char limit per request.
 */
export function chunkText(text: string, maxChars = 4500): string[] {
  if (text.length <= maxChars) return [text]

  const lines = text.split('\n')
  const chunks: string[] = []
  let current = ''

  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim())
      current = ''
    }
    current += line + '\n'
  }
  if (current.trim()) chunks.push(current.trim())

  return chunks
}
