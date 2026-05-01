/**
 * Contract: PR-C2 — `parseRecipients` normalization (Q7).
 *
 * Source: lib/workflows/actions/core/parseRecipients.ts
 * Handler-contracts: see Q7 in learning/docs/handler-contracts.md.
 *
 * Pure-function coverage. Per-handler tests in __tests__/nodes/ verify that
 * Gmail / Outlook / Calendar route their schema-declared multi-recipient
 * fields through this helper.
 */

import { parseRecipients } from '@/lib/workflows/actions/core/parseRecipients'

describe('parseRecipients — empty inputs', () => {
  test('undefined → []', () => {
    expect(parseRecipients(undefined)).toEqual([])
  })

  test('null → []', () => {
    expect(parseRecipients(null)).toEqual([])
  })

  test('empty string → []', () => {
    expect(parseRecipients('')).toEqual([])
  })

  test('empty array → []', () => {
    expect(parseRecipients([])).toEqual([])
  })

  test('whitespace-only string → []', () => {
    expect(parseRecipients('   ')).toEqual([])
  })

  test('CSV of empties → []', () => {
    expect(parseRecipients(', , ,')).toEqual([])
  })
})

describe('parseRecipients — single recipient', () => {
  test('plain string → single-element array', () => {
    expect(parseRecipients('alice@example.com')).toEqual(['alice@example.com'])
  })

  test('single-element array passes through', () => {
    expect(parseRecipients(['alice@example.com'])).toEqual(['alice@example.com'])
  })

  test('leading/trailing whitespace is trimmed', () => {
    expect(parseRecipients('  alice@example.com  ')).toEqual(['alice@example.com'])
  })
})

describe('parseRecipients — CSV splitting', () => {
  test('comma-separated emails are split', () => {
    expect(parseRecipients('alice@x.com, bob@x.com, carol@x.com')).toEqual([
      'alice@x.com',
      'bob@x.com',
      'carol@x.com',
    ])
  })

  test('CSV with no whitespace is split', () => {
    expect(parseRecipients('a@x.com,b@x.com,c@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ])
  })

  test('mixed whitespace around commas is normalized', () => {
    expect(parseRecipients('a@x.com  , b@x.com,c@x.com   , d@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
    ])
  })

  test('empty fragments inside CSV are dropped', () => {
    expect(parseRecipients('a@x.com,,b@x.com')).toEqual(['a@x.com', 'b@x.com'])
  })

  test('trailing comma is tolerated', () => {
    expect(parseRecipients('a@x.com, b@x.com,')).toEqual(['a@x.com', 'b@x.com'])
  })

  test('leading comma is tolerated', () => {
    expect(parseRecipients(',a@x.com,b@x.com')).toEqual(['a@x.com', 'b@x.com'])
  })
})

describe('parseRecipients — array passthrough with normalization', () => {
  test('array of clean emails passes through', () => {
    expect(parseRecipients(['a@x.com', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com'])
  })

  test('array entries are individually trimmed', () => {
    expect(parseRecipients([' a@x.com ', '  b@x.com'])).toEqual(['a@x.com', 'b@x.com'])
  })

  test('empty/whitespace entries inside arrays are dropped', () => {
    expect(parseRecipients(['a@x.com', '', '  ', 'b@x.com'])).toEqual([
      'a@x.com',
      'b@x.com',
    ])
  })

  test('CSV string inside an array element is also split (mixed input)', () => {
    // Real-world workflow output: an upstream node may return a CSV string
    // inside an array. The helper splits each element, so this mixed shape
    // produces a flat list of recipients.
    expect(parseRecipients(['a@x.com, b@x.com', 'c@x.com'])).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ])
  })
})

describe('parseRecipients — Q7 out-of-scope cases', () => {
  test('display-name addresses with quoted comma are NOT preserved as one entry (documented limitation)', () => {
    // Q7 explicitly excludes RFC 5322 display-name parsing. A `"Last, First"
    // <x@y.com>` input is treated as two comma-separated entries by design —
    // the test pins this so a future RFC-aware parser would be a deliberate
    // contract change, not an accidental regression.
    expect(parseRecipients('"Last, First" <x@y.com>')).toEqual([
      '"Last',
      'First" <x@y.com>',
    ])
  })

  test('non-email IDs (Discord-style snowflakes, Slack user IDs) pass through unchanged', () => {
    // `parseRecipients` does no email-format validation — it's a normalizer.
    // Calendar / Gmail validate downstream; Slack/Discord IDs flow through.
    expect(parseRecipients('U-123, U-456')).toEqual(['U-123', 'U-456'])
  })
})
