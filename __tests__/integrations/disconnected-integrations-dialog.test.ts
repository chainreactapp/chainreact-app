/**
 * Contract: `getDisconnectedIntegrations` — the pre-Run "Connect Your
 * Accounts" dialog's helper that walks a workflow's nodes and returns
 * the third-party providers the user hasn't connected.
 *
 * Source: components/workflows/builder/disconnectedIntegrations.ts
 *
 * The underlying primitives (`isConnectedStatus`,
 * `isIntegrationRequired`, `CONNECTION_EXEMPT_PROVIDERS`,
 * `CONNECTED_INTEGRATION_STATUSES`) are tested in
 * `__tests__/integrations/connectionStatus.test.ts`. This file pins
 * the dialog-helper-specific behavior on top of those primitives.
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { getDisconnectedIntegrations } from '@/components/workflows/builder/disconnectedIntegrations'

// ─── getDisconnectedIntegrations — built-in exemptions ──────────────────

describe('getDisconnectedIntegrations — built-in providers', () => {
  test('Manual Trigger node (providerId=automation) is exempted regardless of integrations list', () => {
    const nodes = [
      { id: 'trigger-1', data: { providerId: 'automation', type: 'manual_trigger' } },
    ]
    const integrations: any[] = [] // empty — would otherwise cause every provider to be flagged
    expect(getDisconnectedIntegrations(nodes, integrations)).toEqual([])
  })

  test('HITL Conversation (providerId=ask-human) is exempted', () => {
    const nodes = [
      { id: 'hitl-1', data: { providerId: 'ask-human', type: 'hitl_conversation' } },
    ]
    expect(getDisconnectedIntegrations(nodes, [])).toEqual([])
  })

  test('logic / ai / utility / webhook nodes are exempted', () => {
    const nodes = [
      { id: 'a', data: { providerId: 'logic', type: 'if_then_condition' } },
      { id: 'b', data: { providerId: 'ai', type: 'ai_agent' } },
      { id: 'c', data: { providerId: 'utility', type: 'utility_log' } },
      { id: 'd', data: { providerId: 'webhook', type: 'webhook' } },
    ]
    expect(getDisconnectedIntegrations(nodes, [])).toEqual([])
  })

  test('nodes without a providerId are silently skipped (legacy / placeholder)', () => {
    const nodes = [
      { id: 'placeholder-1', data: { type: 'addAction' } },
      { id: 'no-data-1' },
    ]
    expect(getDisconnectedIntegrations(nodes, [])).toEqual([])
  })
})

// ─── getDisconnectedIntegrations — third-party status checks ────────────

describe('getDisconnectedIntegrations — third-party status checks', () => {
  test('Slack node with status=active is NOT flagged as disconnected', () => {
    const nodes = [
      { id: 'slack-1', data: { providerId: 'slack', type: 'slack_action_send_message' } },
    ]
    const integrations = [
      { provider: 'slack', status: 'active' },
    ]
    expect(getDisconnectedIntegrations(nodes, integrations)).toEqual([])
  })

  test('Gmail node with status=valid is NOT flagged as disconnected', () => {
    const nodes = [
      { id: 'gmail-1', data: { providerId: 'gmail', type: 'gmail_action_send_email' } },
    ]
    const integrations = [
      { provider: 'gmail', status: 'valid' },
    ]
    expect(getDisconnectedIntegrations(nodes, integrations)).toEqual([])
  })

  test('Stripe node with status=connected is NOT flagged', () => {
    const nodes = [
      { id: 'stripe-1', data: { providerId: 'stripe', type: 'stripe_action_create_payment_intent' } },
    ]
    const integrations = [
      { provider: 'stripe', status: 'connected' },
    ]
    expect(getDisconnectedIntegrations(nodes, integrations)).toEqual([])
  })

  test('Slack with status=expired IS flagged as disconnected', () => {
    const nodes = [
      { id: 'slack-1', data: { providerId: 'slack', type: 'slack_action_send_message' } },
    ]
    const integrations = [
      { provider: 'slack', status: 'expired' },
    ]
    const result = getDisconnectedIntegrations(nodes, integrations)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ providerId: 'slack', nodeCount: 1 })
  })

  test('Slack with NO integration row at all IS flagged as disconnected', () => {
    const nodes = [
      { id: 'slack-1', data: { providerId: 'slack', type: 'slack_action_send_message' } },
    ]
    const result = getDisconnectedIntegrations(nodes, [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ providerId: 'slack', nodeCount: 1 })
  })

  test('mixed workflow: Manual Trigger (exempt) + connected Slack + disconnected Stripe → only Stripe flagged', () => {
    const nodes = [
      { id: 't', data: { providerId: 'automation', type: 'manual_trigger' } },
      { id: 'a', data: { providerId: 'slack', type: 'slack_action_send_message' } },
      { id: 'b', data: { providerId: 'stripe', type: 'stripe_action_create_payment_intent' } },
    ]
    const integrations = [
      { provider: 'slack', status: 'active' },
      // No stripe row
    ]
    const result = getDisconnectedIntegrations(nodes, integrations)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ providerId: 'stripe', nodeCount: 1 })
  })

  test('multiple nodes from the same provider count up', () => {
    const nodes = [
      { id: 's1', data: { providerId: 'stripe', type: 'stripe_action_create_payment_intent' } },
      { id: 's2', data: { providerId: 'stripe', type: 'stripe_action_create_customer' } },
      { id: 's3', data: { providerId: 'stripe', type: 'stripe_action_create_refund' } },
    ]
    const result = getDisconnectedIntegrations(nodes, [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ providerId: 'stripe', nodeCount: 3 })
  })
})
