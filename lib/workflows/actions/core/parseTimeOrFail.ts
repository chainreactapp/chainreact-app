/**
 * PR-G0 — strict HH:MM time parser.
 *
 * Replaces the silent `'09:00'` / `'10:00'` substitutions in Calendar /
 * Outlook handlers when the user supplies an invalid or unparseable time
 * string. Audit calls these out as `Change` rows — see
 * learning/docs/handler-defaults-audit.md (createEvent.ts:100, :156;
 * updateEvent.ts:103; createCalendarEvent.ts:110, :190).
 *
 * Behavior:
 *   - undefined / null / ''      → MISSING_REQUIRED_FIELD config failure
 *   - non-string                 → INVALID_TIME_FORMAT validation failure
 *   - string not matching HH:MM  → INVALID_TIME_FORMAT validation failure
 *   - valid '00:00'..'23:59'     → ok with parsed hour/minute
 *
 * 24-hour format only. AM/PM, locale-specific separators, and seconds are
 * all out of scope — workflow config produces ISO-style 24h strings, not
 * locale-formatted display strings.
 *
 * Contract: learning/docs/handler-contracts.md Q11 (no silent substitution).
 */

import type { ActionResult } from './executeWait'
import {
  type MissingRequiredFieldFailure,
  missingRequiredField,
} from './requireExplicitField'

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface InvalidTimeFormatFailure {
  success: false
  category: 'validation'
  error: { code: 'INVALID_TIME_FORMAT'; path: string }
  message: string
}

export type TimeParseFailure = MissingRequiredFieldFailure | InvalidTimeFormatFailure

export type TimeParseResult =
  | { ok: true; hour: number; minute: number; raw: string }
  | { ok: false; failure: TimeParseFailure }

export function invalidTimeFormat(fieldName: string): InvalidTimeFormatFailure {
  return {
    success: false,
    category: 'validation',
    error: { code: 'INVALID_TIME_FORMAT', path: fieldName },
    message: `Field "${fieldName}" must be a 24-hour HH:MM time (e.g., "09:00", "17:30").`,
  }
}

/**
 * Parse a workflow-config time string into hour/minute components, or
 * return a typed failure object the caller can return as ActionResult.
 *
 *   const parsed = parseTimeOrFail(config.startTime, 'startTime')
 *   if (!parsed.ok) return parsed.failure as unknown as ActionResult
 *   const { hour, minute } = parsed
 */
export function parseTimeOrFail(value: unknown, fieldName: string): TimeParseResult {
  if (value === undefined || value === null || value === '') {
    return { ok: false, failure: missingRequiredField(fieldName) }
  }

  if (typeof value !== 'string') {
    return { ok: false, failure: invalidTimeFormat(fieldName) }
  }

  const match = HHMM_PATTERN.exec(value)
  if (!match) {
    return { ok: false, failure: invalidTimeFormat(fieldName) }
  }

  return {
    ok: true,
    hour: Number(match[1]),
    minute: Number(match[2]),
    raw: value,
  }
}

/**
 * Convenience wrapper that returns the failure as ActionResult directly,
 * hiding the cast from handler code:
 *
 *   const parsed = parseTimeOrFailAsResult(config.startTime, 'startTime')
 *   if ('failure' in parsed) return parsed.failure
 *   const { hour, minute } = parsed
 */
export function parseTimeOrFailAsResult(
  value: unknown,
  fieldName: string,
): { hour: number; minute: number; raw: string } | { failure: ActionResult } {
  const result = parseTimeOrFail(value, fieldName)
  if (result.ok) {
    return { hour: result.hour, minute: result.minute, raw: result.raw }
  }
  return { failure: result.failure as unknown as ActionResult }
}

/**
 * Add minutes to an HH:MM time string, returning the same HH:MM format.
 * Wraps at 23:59 → 00:00 (next day) — callers concerned with day rollover
 * must combine this with the date arithmetic separately.
 *
 * Used by Calendar handlers that need "start time + 1 hour" as the end-time
 * default (audit Change rows: createEvent.ts:156, updateEvent.ts:153).
 */
export function addMinutesToTime(hhmm: string, minutes: number): string {
  const parsed = parseTimeOrFail(hhmm, 'time')
  if (!parsed.ok) {
    throw new Error(`addMinutesToTime requires a valid HH:MM input, got "${hhmm}"`)
  }
  const total = parsed.hour * 60 + parsed.minute + minutes
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
