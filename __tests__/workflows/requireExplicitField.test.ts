/**
 * Contract: PR-G0 — `requireExplicitField` (Q11).
 *
 * Source: lib/workflows/actions/core/requireExplicitField.ts
 * Handler-contracts: see Q11 in learning/docs/handler-contracts.md.
 *
 * Pure-function coverage. Per-handler tests in PR-G2..G5 verify that each
 * `Require`-tagged field returns this exact failure shape when absent from
 * config.
 */

import {
  isMissingRequiredFieldFailure,
  missingRequiredField,
  missingRequiredFieldAsResult,
  requireExplicitField,
  requireExplicitFields,
} from '@/lib/workflows/actions/core/requireExplicitField'

describe('Q11 — missingRequiredField returns the standardized config-failure shape', () => {
  test('shape matches Q2 MISSING_VARIABLE pattern', () => {
    expect(missingRequiredField('sendNotifications')).toEqual({
      success: false,
      category: 'config',
      error: { code: 'MISSING_REQUIRED_FIELD', path: 'sendNotifications' },
      message: 'Required field "sendNotifications" is missing.',
    })
  })

  test('preserves the literal field name in path and message', () => {
    const result = missingRequiredField('weird.dotted.path')
    expect(result.error.path).toBe('weird.dotted.path')
    expect(result.message).toContain('weird.dotted.path')
  })

  test('missingRequiredFieldAsResult returns the same value typed as ActionResult', () => {
    const a = missingRequiredField('x')
    const b = missingRequiredFieldAsResult('x') as unknown as typeof a
    expect(b).toEqual(a)
  })
})

describe('Q11 — requireExplicitField identifies missing values', () => {
  test('undefined → missing', () => {
    expect(requireExplicitField({}, 'foo')).not.toBeNull()
  })

  test('null → missing', () => {
    expect(requireExplicitField({ foo: null }, 'foo')).not.toBeNull()
  })

  test('null config object → missing', () => {
    expect(requireExplicitField(null, 'foo')).not.toBeNull()
  })

  test('undefined config object → missing', () => {
    expect(requireExplicitField(undefined, 'foo')).not.toBeNull()
  })

  test('empty string → missing by default (treatEmptyStringAsMissing: true)', () => {
    expect(requireExplicitField({ foo: '' }, 'foo')).not.toBeNull()
  })

  test('empty string → not missing when treatEmptyStringAsMissing: false', () => {
    expect(
      requireExplicitField({ foo: '' }, 'foo', { treatEmptyStringAsMissing: false }),
    ).toBeNull()
  })
})

describe('Q11 — Q5 interaction: 0 / false are valid explicit choices', () => {
  test('false → not missing (boolean toggles like sendNotification)', () => {
    expect(requireExplicitField({ foo: false }, 'foo')).toBeNull()
  })

  test('0 → not missing (numeric defaults like minimum)', () => {
    expect(requireExplicitField({ foo: 0 }, 'foo')).toBeNull()
  })

  test('"none" → not missing (enum values like sendNotifications)', () => {
    expect(requireExplicitField({ foo: 'none' }, 'foo')).toBeNull()
  })

  test('object → not missing', () => {
    expect(requireExplicitField({ foo: {} }, 'foo')).toBeNull()
  })

  test('array → not missing', () => {
    expect(requireExplicitField({ foo: [] }, 'foo')).toBeNull()
  })
})

describe('Q11 — requireExplicitFields short-circuits on first missing', () => {
  test('all present → null', () => {
    expect(
      requireExplicitFields({ a: 'x', b: 'y', c: 'z' }, ['a', 'b', 'c']),
    ).toBeNull()
  })

  test('first missing field is reported', () => {
    const failure = requireExplicitFields({ a: 'x', c: 'z' }, ['a', 'b', 'c'])
    expect(failure).not.toBeNull()
    expect(failure!.error.path).toBe('b')
  })

  test('reports field-name in declaration order, not config order', () => {
    const failure = requireExplicitFields({}, ['second', 'first'])
    expect(failure!.error.path).toBe('second')
  })
})

describe('Q11 — type guard isMissingRequiredFieldFailure', () => {
  test('recognizes the standard shape', () => {
    expect(isMissingRequiredFieldFailure(missingRequiredField('x'))).toBe(true)
  })

  test('rejects MISSING_VARIABLE shape (Q2 — different code)', () => {
    expect(
      isMissingRequiredFieldFailure({
        success: false,
        category: 'config',
        error: { code: 'MISSING_VARIABLE', path: 'x' },
        message: 'Variable "x" not found in input.',
      }),
    ).toBe(false)
  })

  test('rejects success: true', () => {
    expect(
      isMissingRequiredFieldFailure({
        success: true,
        category: 'config',
        error: { code: 'MISSING_REQUIRED_FIELD', path: 'x' },
      }),
    ).toBe(false)
  })

  test('rejects null / undefined / non-object inputs', () => {
    expect(isMissingRequiredFieldFailure(null)).toBe(false)
    expect(isMissingRequiredFieldFailure(undefined)).toBe(false)
    expect(isMissingRequiredFieldFailure('MISSING_REQUIRED_FIELD')).toBe(false)
    expect(isMissingRequiredFieldFailure(42)).toBe(false)
  })

  test('rejects when error.path is not a string', () => {
    expect(
      isMissingRequiredFieldFailure({
        success: false,
        category: 'config',
        error: { code: 'MISSING_REQUIRED_FIELD', path: 42 },
        message: 'x',
      }),
    ).toBe(false)
  })
})
