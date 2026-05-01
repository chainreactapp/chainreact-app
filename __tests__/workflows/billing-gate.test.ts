/**
 * Contract: PR-D follow-up — Q8c billing safeguard is upstream-only.
 *
 * Per learning/docs/handler-contracts.md Q8c, ChainReact's task budget
 * is enforced at the WORKFLOW layer (the execute routes call
 * `deductTasksAtomic` before any handler fires). Per-handler cost
 * checks are intentionally NOT added — adding one would duplicate the
 * upstream guard and risk divergence.
 *
 * This file pins three things:
 *
 *  1. `deductTasksAtomic` returns the documented `resultType` shapes
 *     for each upstream-failure case, so route handlers can branch on
 *     them. Locking the result-type union catches accidental renames.
 *
 *  2. `deductTasksAtomic` is FAIL-CLOSED: if the underlying RPC errors,
 *     the function returns `billing_unavailable` (not silently 'deducted'),
 *     so the route can return 503 instead of letting the workflow run.
 *
 *  3. Both production execute routes structurally call `deductTasksAtomic`
 *     BEFORE invoking the workflow execution service. This is a static
 *     assertion against the source files — if a future refactor re-orders
 *     these calls or removes the guard, the assertion fires.
 *
 * If a real bypass is ever discovered (a handler reachable without
 * deduction), the fix is to plug the route, NOT to add per-handler
 * cost checks. Tracked in pre-launch-cleanup.md §A6.
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const mockRpc = jest.fn()

// Stub the post-success side calls that `deductTasksAtomic` makes after
// a successful RPC: a session update, a task_billing_events update, and a
// monthly_usage RPC. These are non-blocking on their own but need to
// resolve cleanly so the function returns its real result instead of
// hanging or throwing.
const postSuccessUpdate = jest.fn().mockResolvedValue({ error: null })
const postSuccessEq = jest.fn().mockResolvedValue({ error: null })
const billingEventsUpdateChain: any = {
  update: jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  }),
}
const sessionUpdateChain: any = {
  update: jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      then: (cb: any) => Promise.resolve(cb({ error: null })),
    }),
  }),
}

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(() => ({
    rpc: mockRpc,
    from: (table: string) => {
      if (table === 'workflow_execution_sessions') return sessionUpdateChain
      if (table === 'task_billing_events') return billingEventsUpdateChain
      return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) }
    },
  })),
}))

import * as fs from 'fs'
import * as path from 'path'
import { deductTasksAtomic } from '@/lib/workflows/taskDeduction'

beforeEach(() => {
  mockRpc.mockReset()
})

const baseNodes = [
  { id: 'a1', data: { type: 'gmail_action_send_email', isTrigger: false } },
]

describe('Q8c — billing gate is upstream-only', () => {
  describe('deductTasksAtomic — documented resultType shapes', () => {
    test('insufficient_balance: RPC reports user out of tasks → resultType=insufficient_balance + error', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: false,
          result_type: 'insufficient_balance',
          tasks_deducted: 0,
          remaining: 0,
        },
        error: null,
      })

      const result = await deductTasksAtomic(
        'user-1',
        baseNodes,
        [],
        'exec-1',
        false,
      )

      expect(result.resultType).toBe('insufficient_balance')
      expect(result.applied).toBe(false)
      expect(result.error).toBeTruthy()
      expect(result.error).toMatch(/task limit|upgrade|need/i)
    })

    test('subscription_inactive: RPC reports inactive subscription', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: false,
          result_type: 'subscription_inactive',
          tasks_deducted: 0,
          remaining: 0,
        },
        error: null,
      })

      const result = await deductTasksAtomic(
        'user-1',
        baseNodes,
        [],
        'exec-2',
        false,
      )

      expect(result.resultType).toBe('subscription_inactive')
      expect(result.applied).toBe(false)
      expect(result.error).toBeTruthy()
    })

    test('billing_unavailable: RPC errors → fail closed, do NOT silently allow', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      })

      const result = await deductTasksAtomic(
        'user-1',
        baseNodes,
        [],
        'exec-3',
        false,
      )

      expect(result.resultType).toBe('billing_unavailable')
      expect(result.applied).toBe(false)
      // Critical: never returns `deducted` on RPC error.
      expect(result.resultType).not.toBe('deducted')
    })

    test('deducted: happy path — fresh deduction applied', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          result_type: 'deducted',
          tasks_deducted: 1,
          remaining: 99,
        },
        error: null,
      })

      const result = await deductTasksAtomic(
        'user-1',
        baseNodes,
        [],
        'exec-4',
        false,
      )

      expect(result.resultType).toBe('deducted')
      expect(result.applied).toBe(true)
    })

    test('idempotent_replay: same execution_id retried → no fresh charge', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          result_type: 'idempotent_replay',
          tasks_deducted: 1,
          remaining: 99,
          applied: false, // critical: replay path returns applied=false
        },
        error: null,
      })

      const result = await deductTasksAtomic(
        'user-1',
        baseNodes,
        [],
        'exec-5',
        false,
      )

      expect(result.resultType).toBe('idempotent_replay')
      expect(result.applied).toBe(false) // not a fresh charge
    })
  })

  describe('testMode bypass — explicit and traceable', () => {
    test('isTestMode=true returns deducted with applied=false and 0 tasks (no RPC call)', async () => {
      const result = await deductTasksAtomic(
        'user-1',
        baseNodes,
        [],
        'exec-test',
        true,
      )

      expect(result.tasksDeducted).toBe(0)
      expect(result.applied).toBe(false)
      expect(result.resultType).toBe('deducted')
      expect(mockRpc).not.toHaveBeenCalled()
    })
  })

  // ─── Structural assertion: routes call the gate before executing ────
  //
  // This greps the source of the two production execute routes. If a
  // future refactor removes or reorders the deduction call relative to
  // the executeWorkflow / AdvancedExecutionEngine entry point, the test
  // catches it. Brittle by design — that's the point.
  describe('routes structurally invoke deductTasksAtomic before executing the workflow', () => {
    function readRouteSource(rel: string): string {
      const abs = path.resolve(process.cwd(), rel)
      return fs.readFileSync(abs, 'utf8')
    }

    test('app/api/workflows/execute/route.ts calls deductTasksAtomic before executeWorkflow', () => {
      const src = readRouteSource('app/api/workflows/execute/route.ts')
      const deductIdx = src.indexOf('deductTasksAtomic(')
      const executeIdx = src.search(/executeWorkflow\(|AdvancedExecutionEngine|workflowExecutionService\./)
      expect(deductIdx).toBeGreaterThan(-1)
      expect(executeIdx).toBeGreaterThan(-1)
      expect(deductIdx).toBeLessThan(executeIdx)
    })

    test('app/api/workflows/execute-stream/route.ts calls deductTasksAtomic before execute*', () => {
      const src = readRouteSource('app/api/workflows/execute-stream/route.ts')
      const deductIdx = src.indexOf('deductTasksAtomic(')
      const executeIdx = src.search(/executeWorkflow\(|AdvancedExecutionEngine|workflowExecutionService\./)
      expect(deductIdx).toBeGreaterThan(-1)
      expect(executeIdx).toBeGreaterThan(-1)
      expect(deductIdx).toBeLessThan(executeIdx)
    })

    test('execute route returns a non-2xx response on insufficient_balance (fail-closed branch present)', () => {
      // Pin the failure-handling branch text so a refactor can't accidentally
      // remove the early-return without flipping this test.
      const src = readRouteSource('app/api/workflows/execute/route.ts')
      expect(src).toMatch(/insufficient_balance/)
      expect(src).toMatch(/return errorResponse[\s\S]*?402/)
    })
  })
})
