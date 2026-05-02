/**
 * Contract: PR-G5 — Mailchimp / Shopify / AI compliance `Require` rows (Q11).
 *
 * Source files under test:
 *   - mailchimp/addSubscriber.ts             (status — CAN-SPAM / GDPR)
 *   - shopify/updateOrderStatus.ts           (notify_customer)
 *   - aiAgentAction.ts                       (respondInstructions when actionType='respond')
 *
 * Handler-contracts: Q11 (no hidden high-risk defaults).
 *
 * AI agent require is conditional on `actionType === 'respond'`. Other
 * action types (extract, summarize, classify, translate, generate, custom)
 * use different fields and are unaffected. The backfill registry uses
 * `applyWhen` so non-respond ai_agent nodes aren't polluted with the
 * legacy respondInstructions value.
 */

import { resetHarness } from '../helpers/actionTestHarness'

import { mailchimpAddSubscriber } from '@/lib/workflows/actions/mailchimp/addSubscriber'
import { updateShopifyOrderStatus } from '@/lib/workflows/actions/shopify/updateOrderStatus'
import { executeAIAgentAction } from '@/lib/workflows/actions/aiAgentAction'
import {
  applyEntriesToConfig,
  type BackfillEntry,
} from '@/lib/workflows/migrations/handlerDefaultsBackfill'

afterEach(() => {
  resetHarness()
})

const expectMissingRequired = (result: any, path: string) => {
  expect(result).toMatchObject({
    success: false,
    category: 'config',
    error: { code: 'MISSING_REQUIRED_FIELD', path },
  })
}

describe('PR-G5 / Q11 — Mailchimp addSubscriber requires status', () => {
  // Mailchimp uses (config, context) signature.
  const makeContext = () => ({
    userId: 'user-1',
    dataFlowManager: {
      resolveVariable: (v: any) => v,
    },
  }) as any

  test('missing status → MISSING_REQUIRED_FIELD', async () => {
    const result = await mailchimpAddSubscriber(
      { audience_id: 'aud-1', email: 'alice@example.com' },
      makeContext(),
    )
    expectMissingRequired(result, 'status')
  })

  test("explicit status='pending' passes the gate", async () => {
    const result: any = await mailchimpAddSubscriber(
      { audience_id: 'aud-1', email: 'alice@example.com', status: 'pending' },
      makeContext(),
    )
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('status')
    }
  })
})

describe('PR-G5 / Q11 — Shopify updateOrderStatus requires notify_customer', () => {
  test('missing notify_customer → MISSING_REQUIRED_FIELD (no integration lookup)', async () => {
    const result = await updateShopifyOrderStatus(
      { order_id: '123', action: 'fulfill' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'notify_customer')
  })

  test('explicit notify_customer=false passes the gate (Q5: false is valid)', async () => {
    const result: any = await updateShopifyOrderStatus(
      { order_id: '123', action: 'fulfill', notify_customer: false },
      'user-1',
      {},
    )
    // Handler will fail later for unrelated reasons (no Shopify integration
    // in test env). Pin only that the require gate didn't fire.
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('notify_customer')
    }
  })

  test('explicit notify_customer=true passes the gate', async () => {
    const result: any = await updateShopifyOrderStatus(
      { order_id: '123', action: 'cancel', notify_customer: true },
      'user-1',
      {},
    )
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('notify_customer')
    }
  })
})

describe("PR-G5 / Q11 — AI agent requires respondInstructions when actionType='respond'", () => {
  // The full AI agent handler does many things; we only need to confirm
  // it short-circuits with MISSING_REQUIRED_FIELD before any provider call
  // when the require gate fires. The handler's later steps fail for other
  // reasons in the harness, so we assert on result shape, not handler success.
  const makeContext = () => ({
    userId: 'user-1',
    nodeId: 'node-ai-1',
    hasMultipleOutputs: false,
    workflowId: 'wf-1',
    dataFlowManager: {
      resolveVariable: (v: any) => v,
    },
    interceptedActions: [],
  }) as any

  test("actionType='respond' + missing respondInstructions → MISSING_REQUIRED_FIELD", async () => {
    const result = await executeAIAgentAction(
      { actionType: 'respond' },
      {},
      makeContext(),
    )
    expectMissingRequired(result, 'respondInstructions')
  })

  test("actionType='respond' + empty-string respondInstructions → MISSING_REQUIRED_FIELD", async () => {
    const result = await executeAIAgentAction(
      { actionType: 'respond', respondInstructions: '' },
      {},
      makeContext(),
    )
    expectMissingRequired(result, 'respondInstructions')
  })

  test("actionType='respond' + null respondInstructions → MISSING_REQUIRED_FIELD", async () => {
    const result = await executeAIAgentAction(
      { actionType: 'respond', respondInstructions: null },
      {},
      makeContext(),
    )
    expectMissingRequired(result, 'respondInstructions')
  })

  test("actionType='extract' (no respondInstructions) → require gate does NOT fire", async () => {
    // Other action types don't require respondInstructions — only 'respond'.
    const result: any = await executeAIAgentAction(
      { actionType: 'extract', extractFields: 'name\nemail' },
      {},
      makeContext(),
    )
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('respondInstructions')
    }
  })

  test("actionType='custom' (no respondInstructions) → require gate does NOT fire", async () => {
    const result: any = await executeAIAgentAction(
      { actionType: 'custom', prompt: 'do thing' },
      {},
      makeContext(),
    )
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('respondInstructions')
    }
  })
})

describe('PR-G5 — backfill registry applyWhen for respond-only AI nodes', () => {
  const aiEntry: BackfillEntry = {
    pr: 'PR-G5',
    nodeType: 'ai_agent',
    fieldName: 'respondInstructions',
    legacyDefault: 'Respond helpfully to the incoming message',
    auditRef: 'aiAgentAction.ts:213',
    applyWhen: (config) => config.actionType === 'respond',
  }

  test("ai_agent with actionType='respond' and missing respondInstructions → backfilled", () => {
    const result = applyEntriesToConfig(
      { actionType: 'respond' },
      [aiEntry],
    )
    expect(result).not.toBeNull()
    expect(result!.newConfig.respondInstructions).toBe(
      'Respond helpfully to the incoming message',
    )
  })

  test("ai_agent with actionType='extract' → backfill skipped", () => {
    const result = applyEntriesToConfig(
      { actionType: 'extract', extractFields: 'foo' },
      [aiEntry],
    )
    expect(result).toBeNull()
  })

  test("ai_agent with actionType='custom' → backfill skipped", () => {
    const result = applyEntriesToConfig(
      { actionType: 'custom', prompt: 'x' },
      [aiEntry],
    )
    expect(result).toBeNull()
  })

  test("ai_agent with no actionType → backfill skipped (defaults to 'custom')", () => {
    const result = applyEntriesToConfig({ prompt: 'x' }, [aiEntry])
    expect(result).toBeNull()
  })

  test("idempotent: re-running on a respond-backfilled node → no change", () => {
    const first = applyEntriesToConfig({ actionType: 'respond' }, [aiEntry])!
    const second = applyEntriesToConfig(first.newConfig, [aiEntry])
    expect(second).toBeNull()
  })
})
