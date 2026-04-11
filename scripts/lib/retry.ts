/**
 * Exponential backoff retry for flaky network calls.
 *
 * Retries on ElevenLabs/network transient failures (429, 500, 502, 503, 504,
 * ECONNRESET, ETIMEDOUT). Does NOT retry on 400/401/403 (authoritative failures).
 */

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])
const RETRY_CODE_RE = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/

export interface RetryOptions {
  maxAttempts?: number
  baseMs?: number
  onRetry?: (attempt: number, err: unknown, waitMs: number) => void
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4
  const baseMs = opts.baseMs ?? 2000

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts) break
      if (!shouldRetry(err)) break

      // Exponential backoff with jitter: 2s, 8s, 30s, 60s
      const wait = Math.min(60000, baseMs * Math.pow(4, attempt - 1)) + Math.random() * 500
      opts.onRetry?.(attempt, err, wait)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  throw lastErr
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof Error) {
    // Match ElevenLabs API error messages: "ElevenLabs API error 429: ..."
    const statusMatch = err.message.match(/API error (\d+)/)
    if (statusMatch && RETRY_STATUS.has(Number(statusMatch[1]))) return true
    if (RETRY_CODE_RE.test(err.message)) return true
  }
  return false
}
