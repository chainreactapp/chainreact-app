/**
 * Contract: PR-G0 — `parseTimeOrFail` (Q11).
 *
 * Source: lib/workflows/actions/core/parseTimeOrFail.ts
 * Handler-contracts: see Q11 in learning/docs/handler-contracts.md.
 *
 * Replaces silent '09:00' / '10:00' / '17:00' substitutions in Calendar /
 * Outlook handlers (audit Change rows) with explicit validation failure.
 */

import {
  addMinutesToTime,
  invalidTimeFormat,
  parseTimeOrFail,
  parseTimeOrFailAsResult,
} from '@/lib/workflows/actions/core/parseTimeOrFail'

describe('Q11 — parseTimeOrFail accepts valid HH:MM', () => {
  test.each([
    ['00:00', 0, 0],
    ['09:00', 9, 0],
    ['09:30', 9, 30],
    ['12:00', 12, 0],
    ['17:00', 17, 0],
    ['23:59', 23, 59],
  ])('parses %s', (input, hour, minute) => {
    const result = parseTimeOrFail(input, 'startTime')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hour).toBe(hour)
      expect(result.minute).toBe(minute)
      expect(result.raw).toBe(input)
    }
  })
})

describe('Q11 — parseTimeOrFail rejects bad strings as INVALID_TIME_FORMAT', () => {
  test.each([
    '24:00', // hour out of range
    '23:60', // minute out of range
    '9:00', // missing leading zero
    '09:0', // missing minute leading zero
    '09', // no minutes
    '09:00:00', // seconds present
    '9am', // locale string
    '09.00', // wrong separator
    'noon', // text
    ' 09:00', // leading whitespace
    '09:00 ', // trailing whitespace
  ])('rejects %j', (input) => {
    const result = parseTimeOrFail(input, 'startTime')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure).toEqual({
        success: false,
        category: 'validation',
        error: { code: 'INVALID_TIME_FORMAT', path: 'startTime' },
        message: expect.stringContaining('startTime'),
      })
    }
  })
})

describe('Q11 — parseTimeOrFail rejects non-string types as INVALID_TIME_FORMAT', () => {
  test.each([
    [Number.NaN],
    [42],
    [true],
    [false],
    [{}],
    [[]],
    [{ hour: 9 }],
  ])('rejects %j', (input) => {
    const result = parseTimeOrFail(input, 'startTime')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure).toMatchObject({
        category: 'validation',
        error: { code: 'INVALID_TIME_FORMAT' },
      })
    }
  })
})

describe('Q11 — parseTimeOrFail returns MISSING_REQUIRED_FIELD when value absent', () => {
  test.each([undefined, null, ''])('treats %j as missing (not invalid)', (input) => {
    const result = parseTimeOrFail(input, 'startTime')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure).toEqual({
        success: false,
        category: 'config',
        error: { code: 'MISSING_REQUIRED_FIELD', path: 'startTime' },
        message: 'Required field "startTime" is missing.',
      })
    }
  })
})

describe('Q11 — invalidTimeFormat helper produces the canonical shape', () => {
  test('shape matches', () => {
    const failure = invalidTimeFormat('endTime')
    expect(failure).toMatchObject({
      success: false,
      category: 'validation',
      error: { code: 'INVALID_TIME_FORMAT', path: 'endTime' },
    })
    expect(typeof failure.message).toBe('string')
    expect(failure.message).toContain('endTime')
  })
})

describe('Q11 — parseTimeOrFailAsResult returns failure typed as ActionResult', () => {
  test('on success returns parsed components, no failure', () => {
    const result = parseTimeOrFailAsResult('14:30', 'meetingTime')
    expect('failure' in result).toBe(false)
    if (!('failure' in result)) {
      expect(result.hour).toBe(14)
      expect(result.minute).toBe(30)
      expect(result.raw).toBe('14:30')
    }
  })

  test('on missing returns failure object', () => {
    const result = parseTimeOrFailAsResult(undefined, 'meetingTime')
    expect('failure' in result).toBe(true)
    if ('failure' in result) {
      expect(result.failure).toMatchObject({
        success: false,
        category: 'config',
      })
    }
  })

  test('on bad format returns failure object', () => {
    const result = parseTimeOrFailAsResult('badtime', 'meetingTime')
    expect('failure' in result).toBe(true)
    if ('failure' in result) {
      expect(result.failure).toMatchObject({
        success: false,
        category: 'validation',
      })
    }
  })
})

describe('Q11 — addMinutesToTime computes Calendar end-time = start + N minutes', () => {
  test('09:00 + 60 → 10:00', () => {
    expect(addMinutesToTime('09:00', 60)).toBe('10:00')
  })

  test('09:30 + 90 → 11:00', () => {
    expect(addMinutesToTime('09:30', 90)).toBe('11:00')
  })

  test('14:15 + 45 → 15:00', () => {
    expect(addMinutesToTime('14:15', 45)).toBe('15:00')
  })

  test('preserves zero-padding', () => {
    expect(addMinutesToTime('09:00', 1)).toBe('09:01')
  })

  test('wraps around midnight: 23:00 + 90 → 00:30', () => {
    expect(addMinutesToTime('23:00', 90)).toBe('00:30')
  })

  test('wraps backward: 00:30 + (-60) → 23:30', () => {
    expect(addMinutesToTime('00:30', -60)).toBe('23:30')
  })

  test('throws on invalid input', () => {
    expect(() => addMinutesToTime('badtime', 60)).toThrow()
  })
})
