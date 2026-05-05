/**
 * Contract: pre-Run "Connect Your Accounts" dialog correctness.
 *
 * Source files exercised:
 *   - stores/integrationStore.ts (`isConnectedStatus`,
 *     `CONNECTED_INTEGRATION_STATUSES`)
 *   - components/workflows/builder/DisconnectedIntegrationsDialog.tsx
 *     (`getDisconnectedIntegrations`)
 *
 * Background: regression of 2026-05-05 — the dialog narrowly checked
 * `'connected' || 'authorized'`, which falsely flagged providers
 * stored with `'active'` (and other valid synonyms the integration
 * store accepts) as disconnected. Separately, the
 * CONNECTION_EXEMPT_PROVIDERS list omitted built-in providers
 * (`'automation'`, `'ask-human'`), causing Manual Trigger / HITL
 * nodes to ask for OAuth that doesn't exist.
 *
 * This file pins both fixes:
 *   - isConnectedStatus accepts the full canonical set; rejects others.
 *   - getDisconnectedIntegrations skips built-in providers regardless
 *     of integration list contents.
 *   - getDisconnectedIntegrations does NOT flag third-party providers
 *     whose integration row uses any of the canonical "connected"
 *     synonyms.
 */

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// The pure helper lives in `./disconnectedIntegrations.ts` (no React).
// The store import IS pulled in transitively, but only for the
// `isConnectedStatus` function — no zustand subscription happens at
// module load. We still mock the store path defensively in case
// something deep in the store's transitive imports tries to talk to
// Supabase at module-init time.
jest.mock('@/stores/integrationStore', () => {
  const actual = jest.requireActual('@/stores/integrationStore')
  return {
    ...actual,
    useIntegrationStore: jest.fn(),
  }
})

import {
  isConnectedStatus,
  CONNECTED_INTEGRATION_STATUSES,
} from '@/stores/integrationStore'
import { getDisconnectedIntegrations } from '@/components/workflows/builder/disconnectedIntegrations'

// ─── isConnectedStatus ──────────────────────────────────────────────────

describe('isConnectedStatus', () => {
  test('active => connected', () => {
    expect(isConnectedStatus('active')).toBe(true)
  })

  test('valid => connected', () => {
    expect(isConnectedStatus('valid')).toBe(true)
  })

  test('connected => connected (the canonical baseline)', () => {
    expect(isConnectedStatus('connected')).toBe(true)
  })

  test('authorized / ok / ready => connected (all canonical synonyms)', () => {
    expect(isConnectedStatus('authorized')).toBe(true)
    expect(isConnectedStatus('ok')).toBe(true)
    expect(isConnectedStatus('ready')).toBe(true)
  })

  test('case-insensitive — uppercase value still resolves', () => {
    expect(isConnectedStatus('ACTIVE')).toBe(true)
    expect(isConnectedStatus('Connected')).toBe(true)
  })

  test('expired => disconnected', () => {
    expect(isConnectedStatus('expired')).toBe(false)
  })

  test('undefined => disconnected', () => {
    expect(isConnectedStatus(undefined)).toBe(false)
  })

  test('null / empty string => disconnected', () => {
    expect(isConnectedStatus(null)).toBe(false)
    expect(isConnectedStatus('')).toBe(false)
  })

  test('any other status (needs_reauthorization, error, disconnected) => disconnected', () => {
    expect(isConnectedStatus('needs_reauthorization')).toBe(false)
    expect(isConnectedStatus('error')).toBe(false)
    expect(isConnectedStatus('disconnected')).toBe(false)
  })

  test('CONNECTED_INTEGRATION_STATUSES exports the exact canonical set', () => {
    expect([...CONNECTED_INTEGRATION_STATUSES].sort()).toEqual(
      ['active', 'authorized', 'connected', 'ok', 'ready', 'valid'],
    )
  })
})

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
