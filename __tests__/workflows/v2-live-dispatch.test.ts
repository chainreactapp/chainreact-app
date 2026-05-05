/**
 * Contract: PR-V2-FLAG (Phase 3 of v2 canonical engine plan) —
 * dispatch decision for live / sequential execution: v1
 * (AdvancedExecutionEngine) vs v2 (WorkflowExecutionService), gated by
 * ENABLE_V2_LIVE_EXECUTION env flag AND user_profiles.opt_in_v2_execution.
 *
 * Source: lib/execution/v2LiveExecutionDispatch.ts
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3).
 *
 * What this file proves (pure-function level):
 *
 *   Live / sequential modes:
 *     - flag false + opt-in false → v1 (useV2: false, engine: v1)
 *     - flag false + opt-in true  → v1 (engine: v1)
 *     - flag true  + opt-in false → v1 (engine: v1)
 *     - flag true  + opt-in true  → v2 (useV2: true, engine: v2)
 *     - sequential mirrors live for all four cases
 *
 *   Sandbox / test modes:
 *     - useV2 is always false (sandbox runs v2's existing sandbox path,
 *       not the live-dispatch v2 path this PR introduces)
 *     - log.executionEngine is always 'v2' regardless of flag/opt-in,
 *       because the sandbox path is owned by v2's WorkflowExecutionService
 *
 *   Log shape:
 *     - All four expected fields present
 *     - executionMode echoed verbatim
 *     - flag and opt-in echoed verbatim for observability
 */

import { decideV2LiveDispatch } from '@/lib/execution/v2LiveExecutionDispatch'

// ─── Live / sequential modes — the 4 cases from the spec ────────────────

describe('decideV2LiveDispatch — live mode', () => {
  test('flag false + opt-in false → v1', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'live',
      flagEnabled: false,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })

  test('flag false + opt-in true → v1 (opt-in alone is not enough)', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'live',
      flagEnabled: false,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })

  test('flag true + opt-in false → v1 (flag alone is not enough)', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'live',
      flagEnabled: true,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })

  test('flag true + opt-in true → v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'live',
      flagEnabled: true,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(true)
    expect(decision.log.executionEngine).toBe('v2')
  })
})

describe('decideV2LiveDispatch — sequential mode mirrors live', () => {
  test('sequential + flag true + opt-in true → v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'sequential',
      flagEnabled: true,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(true)
    expect(decision.log.executionEngine).toBe('v2')
  })

  test('sequential + flag true + opt-in false → v1', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'sequential',
      flagEnabled: true,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })

  test('sequential + flag false + opt-in true → v1', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'sequential',
      flagEnabled: false,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })
})

// ─── Webhook mode (PR-V2-WEBHOOKS) — gates on same flag + opt-in pair ──

describe('decideV2LiveDispatch — webhook mode mirrors live gating', () => {
  test('webhook + flag true + opt-in true → v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'webhook',
      flagEnabled: true,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(true)
    expect(decision.log.executionEngine).toBe('v2')
    expect(decision.log.executionMode).toBe('webhook')
  })

  test('webhook + flag true + opt-in false → v1', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'webhook',
      flagEnabled: true,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })

  test('webhook + flag false + opt-in true → v1', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'webhook',
      flagEnabled: false,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })
})

// ─── Scheduled mode (PR-V2-CRON, forward-looking) ──────────────────────

describe('decideV2LiveDispatch — scheduled mode mirrors live gating', () => {
  test('scheduled + flag true + opt-in true → v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'scheduled',
      flagEnabled: true,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(true)
    expect(decision.log.executionEngine).toBe('v2')
    expect(decision.log.executionMode).toBe('scheduled')
  })

  test('scheduled + flag true + opt-in false → v1', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'scheduled',
      flagEnabled: true,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })

  test('scheduled + flag false + opt-in true → v1', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'scheduled',
      flagEnabled: false,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v1')
  })
})

// ─── Sandbox / test mode — never goes through live dispatch ─────────────

describe('decideV2LiveDispatch — sandbox always reports v2 + useV2 false', () => {
  test('sandbox + flag true + opt-in true → useV2 false, engine v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'sandbox',
      flagEnabled: true,
      userOptedIn: true,
    })
    // Sandbox doesn't go through the live-dispatch v2 path — it always
    // ran on v2's existing sandbox path. useV2 is the live-dispatch
    // boolean specifically; it stays false.
    expect(decision.useV2).toBe(false)
    // But the rollout dashboard log accurately reflects that sandbox
    // ran on v2 (not v1) so the engine field doesn't lie.
    expect(decision.log.executionEngine).toBe('v2')
  })

  test('sandbox + flag false + opt-in false → useV2 false, engine v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'sandbox',
      flagEnabled: false,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v2')
  })

  test('sandbox + flag true + opt-in false → useV2 false, engine v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'sandbox',
      flagEnabled: true,
      userOptedIn: false,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v2')
  })

  test('sandbox + flag false + opt-in true → useV2 false, engine v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'sandbox',
      flagEnabled: false,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v2')
  })
})

// ─── Unrecognized / future modes default conservatively ─────────────────
//
// Important for forward compat — if a new executionMode value is ever
// passed through (e.g., 'debug'), the helper should not accidentally
// treat it as live and route it to v1 with confusing log output. Treat
// non-live-mode values like sandbox: v2 path, useV2 false.

describe('decideV2LiveDispatch — unknown modes default to v2 sandbox semantics', () => {
  test('unrecognized mode → useV2 false, engine v2', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'debug-future-mode',
      flagEnabled: true,
      userOptedIn: true,
    })
    expect(decision.useV2).toBe(false)
    expect(decision.log.executionEngine).toBe('v2')
  })
})

// ─── Log shape — observability contract ─────────────────────────────────

describe('decideV2LiveDispatch — structured log payload', () => {
  test('log includes all four observability fields with correct types', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'live',
      flagEnabled: true,
      userOptedIn: false,
    })
    expect(decision.log).toEqual({
      executionEngine: 'v1',
      executionMode: 'live',
      v2LiveExecutionEnabled: true,
      userOptedIntoV2Execution: false,
    })
  })

  test('log echoes executionMode verbatim (sandbox case)', () => {
    const decision = decideV2LiveDispatch({
      executionMode: 'sandbox',
      flagEnabled: false,
      userOptedIn: false,
    })
    expect(decision.log.executionMode).toBe('sandbox')
  })

  test('log echoes flag + opt-in independently of dispatch outcome', () => {
    // Flag and opt-in echo through to the log even when they don't
    // produce useV2: true. This lets the rollout dashboard distinguish
    // "user opted in but flag is off" from "flag is on but user opted
    // out" — both produce v1, but the cause differs.
    const flagOnlyDecision = decideV2LiveDispatch({
      executionMode: 'live',
      flagEnabled: true,
      userOptedIn: false,
    })
    expect(flagOnlyDecision.log.v2LiveExecutionEnabled).toBe(true)
    expect(flagOnlyDecision.log.userOptedIntoV2Execution).toBe(false)

    const optInOnlyDecision = decideV2LiveDispatch({
      executionMode: 'live',
      flagEnabled: false,
      userOptedIn: true,
    })
    expect(optInOnlyDecision.log.v2LiveExecutionEnabled).toBe(false)
    expect(optInOnlyDecision.log.userOptedIntoV2Execution).toBe(true)
  })
})
