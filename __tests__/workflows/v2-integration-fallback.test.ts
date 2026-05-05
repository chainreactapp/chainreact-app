/**
 * Contract: PR-V2C — registry fallback for v2 integration handlers.
 *
 * Source: lib/services/executionHandlers/registryFallback.ts
 *         lib/services/executionHandlers/integrationHandlers.ts
 *         lib/services/integrations/{gmail,slack,google}IntegrationService.ts
 *
 * Background: v2's `IntegrationNodeHandlers` and the per-provider
 * services historically threw `Unknown ... action` / `not yet
 * implemented` on any node type without an explicit `switch` case. v1's
 * registry-based `executeAction` covers ~330 node types via a registry.
 * The fallback routes unknown v2 node types through the v1 registry so
 * Stripe / Shopify / GitHub / Twitter / Mailchimp / Monday.com / etc.
 * workflows survive the v1 → v2 cutover without a multi-week porting
 * marathon.
 *
 * What this file proves:
 *   1. Unknown v2 node type routes to executeAction (no throw).
 *   2. Registry `success: false` becomes a thrown error (v2 convention).
 *   3. `executionId` and `rootExecutionId` are passed through in the
 *      input bag so downstream Q4 idempotency keys + Stripe headers
 *      align across retries.
 *   4. testMode short-circuit: when `context.testMode === true`, the
 *      fallback returns a deterministic mock WITHOUT calling
 *      `executeAction`. This guarantees zero real provider calls via
 *      the fallback in sandbox / test runs, even if a registry
 *      handler lacks Q8d self-abort.
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md
 */

// `lib/secrets.ts` declares `server-only`. Stub it so the module graph
// (which v2 services pull in transitively) loads under Jest.
jest.mock('server-only', () => ({}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

// Mock `executeAction` at the module boundary so we don't need a real
// Stripe / Shopify handler to exercise the fallback path.
jest.mock('@/lib/workflows/executeNode', () => ({
  executeAction: jest.fn(),
}))

import { executeAction } from '@/lib/workflows/executeNode'
import { fallbackToRegistry } from '@/lib/services/executionHandlers/registryFallback'

const mockedExecuteAction = executeAction as jest.MockedFunction<typeof executeAction>

const baseContext = {
  userId: 'user-1',
  workflowId: 'wf-1',
  executionId: 'exec-1',
  testMode: false,
  data: {},
} as any

beforeEach(() => {
  jest.clearAllMocks()
})

// ─── 1. Unknown v2 node type routes to executeAction ────────────────────

describe('fallbackToRegistry — unknown v2 node type routes to executeAction', () => {
  test('Stripe (no explicit v2 case) lands in executeAction with the right shape', async () => {
    mockedExecuteAction.mockResolvedValue({
      success: true,
      output: { paymentIntentId: 'pi_123' },
    } as any)

    const node = {
      id: 'node-stripe',
      data: {
        type: 'stripe_action_create_payment_intent',
        config: { amount: 1000 },
      },
    }

    const result = await fallbackToRegistry(node, baseContext, {
      source: 'IntegrationNodeHandlers',
    })

    expect(mockedExecuteAction).toHaveBeenCalledTimes(1)
    expect(mockedExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({
            type: 'stripe_action_create_payment_intent',
          }),
        }),
        userId: 'user-1',
        workflowId: 'wf-1',
        executionMode: 'live',
      }),
    )
    expect(result).toEqual({ paymentIntentId: 'pi_123' })
  })

  test('Shopify and other no-explicit-case providers route the same way', async () => {
    mockedExecuteAction.mockResolvedValue({
      success: true,
      output: { customerId: 12345 },
    } as any)

    const node = {
      id: 'node-shopify',
      data: { type: 'shopify_action_create_customer', config: {} },
    }

    const result = await fallbackToRegistry(node, baseContext, {
      source: 'IntegrationNodeHandlers',
    })

    expect(mockedExecuteAction).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ customerId: 12345 })
  })
})

// ─── 2. Registry success:false → throw (v2 convention) ──────────────────

describe('fallbackToRegistry — registry success:false becomes thrown error', () => {
  test('throws with the registry error message when result.success is false', async () => {
    mockedExecuteAction.mockResolvedValue({
      success: false,
      message: 'Stripe charge failed: insufficient funds',
    } as any)

    const node = {
      id: 'node-stripe',
      data: { type: 'stripe_action_create_charge', config: {} },
    }

    await expect(
      fallbackToRegistry(node, baseContext, { source: 'X' }),
    ).rejects.toThrow('Stripe charge failed: insufficient funds')
  })

  test('falls back to result.error if message is missing', async () => {
    mockedExecuteAction.mockResolvedValue({
      success: false,
      error: 'NETWORK_TIMEOUT',
    } as any)

    const node = {
      id: 'node-x',
      data: { type: 'twitter_action_post_tweet', config: {} },
    }

    await expect(
      fallbackToRegistry(node, baseContext, { source: 'X' }),
    ).rejects.toThrow('NETWORK_TIMEOUT')
  })

  test('falls back to a generic message if both are missing', async () => {
    mockedExecuteAction.mockResolvedValue({ success: false } as any)

    const node = {
      id: 'node-x',
      data: { type: 'mailchimp_action_subscribe', config: {} },
    }

    await expect(
      fallbackToRegistry(node, baseContext, { source: 'X' }),
    ).rejects.toThrow('Action mailchimp_action_subscribe failed')
  })
})

// ─── 3. executionId + rootExecutionId pass-through (Q4 lineage) ────────

describe('fallbackToRegistry — Q4 lineage pass-through', () => {
  test('passes executionId and rootExecutionId through the input bag', async () => {
    mockedExecuteAction.mockResolvedValue({
      success: true,
      output: {},
    } as any)

    const retryContext = {
      ...baseContext,
      executionId: 'retry-session-2',
      rootExecutionId: 'original-session-1',
    }

    const node = {
      id: 'node-stripe',
      data: { type: 'stripe_action_create_charge', config: {} },
    }

    await fallbackToRegistry(node, retryContext, {
      source: 'IntegrationNodeHandlers',
    })

    expect(mockedExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          executionId: 'retry-session-2',
          rootExecutionId: 'original-session-1',
          workflowId: 'wf-1',
          nodeId: 'node-stripe',
        }),
      }),
    )
  })

  test('rootExecutionId falls back to executionId when not on context (pre-Phase-2 v2 lineage)', async () => {
    mockedExecuteAction.mockResolvedValue({
      success: true,
      output: {},
    } as any)

    // Context has executionId but NO rootExecutionId — represents v2's
    // current state before the Phase-2 lineage commit.
    const node = {
      id: 'node-shopify',
      data: { type: 'shopify_action_create_order', config: {} },
    }

    await fallbackToRegistry(node, baseContext, {
      source: 'IntegrationNodeHandlers',
    })

    expect(mockedExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          executionId: 'exec-1',
          rootExecutionId: 'exec-1', // = executionId when root not threaded
        }),
      }),
    )
  })
})

// ─── 4. testMode short-circuit (safety contract) ────────────────────────

describe('fallbackToRegistry — testMode safety short-circuit', () => {
  test('does NOT call executeAction when context.testMode is true', async () => {
    const testContext = { ...baseContext, testMode: true }
    const node = {
      id: 'node-stripe',
      data: { type: 'stripe_action_create_charge', config: { amount: 1000 } },
    }

    const result = await fallbackToRegistry(node, testContext, {
      source: 'IntegrationNodeHandlers',
    })

    expect(mockedExecuteAction).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      __testModeFallback: true,
      nodeType: 'stripe_action_create_charge',
      mockData: true,
    })
  })

  test('mock result includes the source label for traceability', async () => {
    const testContext = { ...baseContext, testMode: true }
    const node = {
      id: 'node-shopify',
      data: { type: 'shopify_action_create_order', config: {} },
    }

    const result = await fallbackToRegistry(node, testContext, {
      source: 'GmailIntegrationService',
    })

    expect(result.message).toContain('GmailIntegrationService')
    expect(result.message).toContain('shopify_action_create_order')
  })

  test('testMode short-circuit fires regardless of node type', async () => {
    const testContext = { ...baseContext, testMode: true }

    const types = [
      'stripe_action_create_payment_intent',
      'shopify_action_create_order',
      'twitter_action_post_tweet',
      'mailchimp_action_subscribe',
      'github_action_create_issue',
      'monday_action_create_item',
    ]

    for (const type of types) {
      const result = await fallbackToRegistry(
        { id: 'n1', data: { type, config: {} } },
        testContext,
        { source: 'IntegrationNodeHandlers' },
      )
      expect(result.__testModeFallback).toBe(true)
    }

    expect(mockedExecuteAction).not.toHaveBeenCalled()
  })
})
