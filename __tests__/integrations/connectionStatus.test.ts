/**
 * Single-source-of-truth contract for integration connection state.
 *
 * Source: lib/integrations/connectionStatus.ts
 *
 * What this file proves:
 *   - `isConnectedStatus` accepts the full canonical 6-value set.
 *   - Status values outside the set (expired / undefined / null /
 *     arbitrary) resolve to disconnected.
 *   - `isIntegrationRequired` returns false for built-ins
 *     (ai / ask-human / automation / logic / utility / webhook) and
 *     true for real third-party providers (slack / gmail / stripe / etc.).
 *   - `CONNECTED_INTEGRATION_STATUSES` and `CONNECTION_EXEMPT_PROVIDERS`
 *     export the exact canonical sets — pinning these prevents future
 *     drift where a contributor adds a status name to one consumer
 *     but not the canonical list.
 *
 * Background — the 2026-05-05 regression: the "Connect Your Accounts"
 * dialog narrowly checked `status === 'connected' || 'authorized'`
 * while the integration store accepted six values. Slack with
 * `status: 'active'` was wrongly flagged disconnected. Separately, the
 * dialog's exempt list omitted `automation` and `ask-human`, so
 * Manual Trigger / HITL nodes asked for OAuth that doesn't exist.
 * This file pins both invariants.
 */

import {
  CONNECTED_INTEGRATION_STATUSES,
  CONNECTION_EXEMPT_PROVIDERS,
  isConnectedStatus,
  isIntegrationRequired,
} from '@/lib/integrations/connectionStatus'

// ─── isConnectedStatus — six-value canonical set ────────────────────────

describe('isConnectedStatus', () => {
  test('connected => connected (the canonical baseline)', () => {
    expect(isConnectedStatus('connected')).toBe(true)
  })

  test('authorized => connected', () => {
    expect(isConnectedStatus('authorized')).toBe(true)
  })

  test('active => connected (the bug-fix case for Slack)', () => {
    expect(isConnectedStatus('active')).toBe(true)
  })

  test('valid => connected', () => {
    expect(isConnectedStatus('valid')).toBe(true)
  })

  test('ok => connected', () => {
    expect(isConnectedStatus('ok')).toBe(true)
  })

  test('ready => connected', () => {
    expect(isConnectedStatus('ready')).toBe(true)
  })

  test('case-insensitive — uppercase / mixed-case still resolves', () => {
    expect(isConnectedStatus('ACTIVE')).toBe(true)
    expect(isConnectedStatus('Connected')).toBe(true)
    expect(isConnectedStatus('AuThOrIzEd')).toBe(true)
  })

  test('expired => disconnected', () => {
    expect(isConnectedStatus('expired')).toBe(false)
  })

  test('undefined / null / empty string => disconnected', () => {
    expect(isConnectedStatus(undefined)).toBe(false)
    expect(isConnectedStatus(null)).toBe(false)
    expect(isConnectedStatus('')).toBe(false)
  })

  test('any other status => disconnected', () => {
    expect(isConnectedStatus('needs_reauthorization')).toBe(false)
    expect(isConnectedStatus('error')).toBe(false)
    expect(isConnectedStatus('disconnected')).toBe(false)
    expect(isConnectedStatus('paused')).toBe(false)
    expect(isConnectedStatus('unknown_status_value')).toBe(false)
  })

  test('CONNECTED_INTEGRATION_STATUSES exports the exact canonical set', () => {
    expect([...CONNECTED_INTEGRATION_STATUSES].sort()).toEqual(
      ['active', 'authorized', 'connected', 'ok', 'ready', 'valid'],
    )
  })
})

// ─── isIntegrationRequired — built-in exemptions ────────────────────────

describe('isIntegrationRequired — built-in providers (no OAuth)', () => {
  test('automation (Manual Trigger / Wait-for-Event) is NOT required', () => {
    expect(isIntegrationRequired('automation')).toBe(false)
  })

  test('ask-human (HITL Conversation) is NOT required', () => {
    expect(isIntegrationRequired('ask-human')).toBe(false)
  })

  test('logic (if / router / loop / delay / http_request) is NOT required', () => {
    expect(isIntegrationRequired('logic')).toBe(false)
  })

  test('ai (AI Agent / Router — platform-managed keys) is NOT required', () => {
    expect(isIntegrationRequired('ai')).toBe(false)
  })

  test('utility (built-in utility nodes) is NOT required', () => {
    expect(isIntegrationRequired('utility')).toBe(false)
  })

  test('webhook (built-in HMAC trigger) is NOT required', () => {
    expect(isIntegrationRequired('webhook')).toBe(false)
  })

  test('CONNECTION_EXEMPT_PROVIDERS exports the exact 6-element canonical list', () => {
    expect([...CONNECTION_EXEMPT_PROVIDERS].sort()).toEqual(
      ['ai', 'ask-human', 'automation', 'logic', 'utility', 'webhook'],
    )
  })
})

describe('isIntegrationRequired — real third-party providers', () => {
  test.each([
    'slack',
    'gmail',
    'stripe',
    'discord',
    'notion',
    'airtable',
    'github',
    'hubspot',
    'mailchimp',
    'shopify',
    'google-sheets',
    'google-drive',
    'google-calendar',
    'google-docs',
    'microsoft-outlook',
    'microsoft-onenote',
    'microsoft-excel',
    'teams',
    'monday',
    'trello',
    'twitter',
    'facebook',
    'dropbox',
    'onedrive',
  ])('%s requires a connection', (providerId) => {
    expect(isIntegrationRequired(providerId)).toBe(true)
  })
})

describe('isIntegrationRequired — empty / missing provider', () => {
  test('undefined providerId => not required (no prompt)', () => {
    expect(isIntegrationRequired(undefined)).toBe(false)
  })

  test('null providerId => not required', () => {
    expect(isIntegrationRequired(null)).toBe(false)
  })

  test('empty string providerId => not required', () => {
    expect(isIntegrationRequired('')).toBe(false)
  })
})

// ─── Drift guard — the legacy aliases must NOT be exempt ────────────────
//
// These IDs were in earlier inline exempt-lists (e.g. the dialog's old
// list, useIntegrationSelection's hardcoded set) but don't correspond
// to any actual node providerId in lib/workflows/nodes/providers/.
// If any of them ever gets used as a real providerId, the user would
// see no OAuth prompt — which would be wrong. Pin the explicit
// rejection so a future refactor doesn't silently re-add them.

describe('isIntegrationRequired — legacy aliases stay rejected', () => {
  test.each(['manual', 'schedule', 'core', 'mapper', 'transformer', 'http'])(
    '%s (legacy alias, not a real providerId) requires connection if ever used',
    (legacyId) => {
      expect(isIntegrationRequired(legacyId)).toBe(true)
    },
  )
})
