/**
 * Contract: PR-V2-CRON — scheduled-trigger cron passes
 * `executionMode: 'scheduled'` to /api/workflows/execute, and the route's
 * v1-fork predicate recognizes 'scheduled' (and 'webhook') as
 * v1-eligible modes alongside 'live' / 'sequential'.
 *
 * Without the predicate fix, non-opted-in users with scheduled triggers
 * would fall to the v2 catch-all path → double-charge (route bills with
 * synthetic key, v2 bills with session UUID; different keys, same user).
 *
 * Sources:
 *   - app/api/cron/execute-scheduled-triggers/route.ts
 *   - app/api/workflows/execute/route.ts
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3).
 */

import * as fs from 'fs'
import * as path from 'path'

function readSource(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

describe('PR-V2-CRON — cron + route source contracts', () => {
  test('cron passes executionMode: "scheduled" (not "live")', () => {
    const src = readSource('app/api/cron/execute-scheduled-triggers/route.ts')
    expect(src).toMatch(/executionMode:\s*['"]scheduled['"]/)
    // Defensive — make sure the old 'live' literal isn't lingering as
    // a separate executionMode (string can appear in comments).
    const liveAsExecutionMode = /executionMode:\s*['"]live['"]/.test(src)
    expect(liveAsExecutionMode).toBe(false)
  })

  test('execute route v1-fork predicate includes "scheduled"', () => {
    const src = readSource('app/api/workflows/execute/route.ts')
    // The predicate has changed shape over time — assert that
    // 'scheduled' appears in the v1-fork mode predicate.
    expect(src).toMatch(/executionMode\s*===\s*['"]scheduled['"]/)
  })

  test('execute route v1-fork predicate includes "webhook"', () => {
    // Forward-looking — direct-caller webhook ports (PR-V2-WEBHOOK-{name})
    // will rely on this so non-opted-in webhooks fall to v1 cleanly.
    const src = readSource('app/api/workflows/execute/route.ts')
    expect(src).toMatch(/executionMode\s*===\s*['"]webhook['"]/)
  })

  test('execute route v1-fork still includes "live" and "sequential"', () => {
    // Don't regress the original gate.
    const src = readSource('app/api/workflows/execute/route.ts')
    expect(src).toMatch(/executionMode\s*===\s*['"]live['"]/)
    expect(src).toMatch(/executionMode\s*===\s*['"]sequential['"]/)
  })
})

// ─── Dispatch helper behavior for scheduled mode ───────────────────────
//
// Already covered in `__tests__/workflows/v2-live-dispatch.test.ts` —
// these are quick reaffirmations bound to the cron + route shape so a
// future refactor that breaks scheduled-mode gating fails this file.

import { decideV2LiveDispatch } from '@/lib/execution/v2LiveExecutionDispatch'

describe('PR-V2-CRON — dispatch behavior for scheduled mode', () => {
  test('scheduled + flag off + opt-in false → v1 (default cron path)', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'scheduled',
      flagEnabled: false,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
    expect(decision.log.executionMode).toBe('scheduled')
  })

  test('scheduled + flag on + opt-in true → v2 (opted-in cron user)', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'scheduled',
      flagEnabled: true,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(true)
    expect(decision.log.executionEngine).toBe('v2')
  })

  test('scheduled + flag on + opt-in false → v1 (flag alone is not enough, same gate as live)', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'scheduled',
      flagEnabled: true,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })
})
