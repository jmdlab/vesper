/**
 * Dumb lockfile for preventing concurrent pipeline runs on the same slug.
 *
 * Per-slug scope: two different meditations can generate in parallel.
 * Same slug+lang cannot — they'd race on _tmp_insert and _tmp_breathing dirs.
 *
 * Stale-lock detection: if PID in lockfile is no longer running, or if the
 * lock is older than 30 min, steal it with a warning. The 30-min limit prevents
 * a crashed process from blocking forever.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'

const STALE_LOCK_MS = 30 * 60 * 1000  // 30 min

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)  // signal 0 = check existence only
    return true
  } catch {
    return false
  }
}

export function acquireLock(lockPath: string, cmd: string): () => void {
  mkdirSync(dirname(lockPath), { recursive: true })

  if (existsSync(lockPath)) {
    try {
      const existing = JSON.parse(readFileSync(lockPath, 'utf-8'))
      const age = Date.now() - (existing.startedAt ?? 0)
      if (isPidAlive(existing.pid) && age < STALE_LOCK_MS) {
        throw new Error(
          `Lock held by pid ${existing.pid} running "${existing.cmd}" (${Math.round(age / 1000)}s ago).\n` +
          `If that process is actually hung, delete ${lockPath} manually.`
        )
      }
      console.warn(`    ⚠ stealing stale lock (pid ${existing.pid}, age ${Math.round(age / 1000)}s)`)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Lock held')) throw e
      console.warn(`    ⚠ malformed lockfile, overwriting: ${lockPath}`)
    }
  }

  writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    startedAt: Date.now(),
    cmd,
  }))

  // Return release function to call in finally
  return () => {
    try { unlinkSync(lockPath) } catch { /* already gone */ }
  }
}
