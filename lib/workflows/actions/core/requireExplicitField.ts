/**
 * PR-G0 — explicit-field validation helper.
 *
 * Returns the standardized config-failure shape when a high-risk field
 * (notification toggles, visibility, share scope, compliance status, etc.)
 * has not been explicitly set on a workflow node's config. PR-G2..G5
 * handlers call this to remove silent handler-side defaults — see the
 * `Require` rows in learning/docs/handler-defaults-audit.md.
 *
 * Failure shape mirrors the Q2 MISSING_VARIABLE shape:
 *
 *   {
 *     success: false,
 *     category: 'config',
 *     error: { code: 'MISSING_REQUIRED_FIELD', path: '<fieldName>' },
 *     message: 'Required field "<fieldName>" is missing.',
 *   }
 *
 * The `error` field is structured ({code, path}) even though ActionResult.error
 * is typed as `string`. This matches the engine's MISSING_VARIABLE conversion
 * in lib/services/nodeExecutionService.ts and is documented on ActionResult
 * in lib/workflows/actions/core/executeWait.ts.
 *
 * Q5 semantics: `0`, `false`, and (for fields that allow them) `''` are valid
 * explicit choices and pass through. Only `null` / `undefined` / missing-key
 * count as "not explicitly set." High-risk enum fields (e.g. sendNotifications:
 * 'all'|'some'|'none') will treat `''` as missing because their schema
 * disallows blank — pass `treatEmptyStringAsMissing: true` for those.
 *
 * Contract: learning/docs/handler-contracts.md Q11.
 */

import type { ActionResult } from './executeWait'

/**
 * The structured shape produced by `missingRequiredField`. Defined as a
 * standalone interface (not extending ActionResult) so callers that want
 * to assert on the shape can do so with strict type discrimination, while
 * the value remains assignable to ActionResult via the engine pattern.
 */
export interface MissingRequiredFieldFailure {
  success: false
  category: 'config'
  error: { code: 'MISSING_REQUIRED_FIELD'; path: string }
  message: string
}

export interface RequireExplicitFieldOptions {
  /**
   * Treat `''` (empty string) as missing. Default `true` because the audit's
   * Require rows are all enum / boolean / scoped-value fields where blank is
   * not a valid explicit choice. Set false for free-text fields that
   * legitimately accept blank.
   */
  treatEmptyStringAsMissing?: boolean
}

export function missingRequiredField(fieldName: string): MissingRequiredFieldFailure {
  return {
    success: false,
    category: 'config',
    error: { code: 'MISSING_REQUIRED_FIELD', path: fieldName },
    message: `Required field "${fieldName}" is missing.`,
  }
}

/**
 * Returns the standardized failure object if `config[fieldName]` is missing,
 * or `null` if the field is set to a valid explicit value.
 *
 * Usage in a handler:
 *
 *   const missing = requireExplicitField(config, 'sendNotifications')
 *   if (missing) return missing as unknown as ActionResult
 *   // ...continue with config.sendNotifications guaranteed defined.
 */
export function requireExplicitField(
  config: Record<string, any> | null | undefined,
  fieldName: string,
  options: RequireExplicitFieldOptions = {},
): MissingRequiredFieldFailure | null {
  const treatEmptyAsMissing = options.treatEmptyStringAsMissing ?? true

  if (config === null || config === undefined) {
    return missingRequiredField(fieldName)
  }

  const value = config[fieldName]

  if (value === undefined || value === null) {
    return missingRequiredField(fieldName)
  }

  if (treatEmptyAsMissing && value === '') {
    return missingRequiredField(fieldName)
  }

  return null
}

/**
 * Validate multiple required fields in one call. Returns the first missing
 * failure encountered, in the order given. Useful for handlers with several
 * high-risk fields (e.g. createEvent: sendNotifications, guestsCanInviteOthers,
 * guestsCanSeeOtherGuests).
 */
export function requireExplicitFields(
  config: Record<string, any> | null | undefined,
  fieldNames: readonly string[],
  options: RequireExplicitFieldOptions = {},
): MissingRequiredFieldFailure | null {
  for (const fieldName of fieldNames) {
    const missing = requireExplicitField(config, fieldName, options)
    if (missing) return missing
  }
  return null
}

/**
 * Type guard so callers / tests can narrow without importing the interface
 * shape directly.
 */
export function isMissingRequiredFieldFailure(value: unknown): value is MissingRequiredFieldFailure {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.success !== false) return false
  if (v.category !== 'config') return false
  const err = v.error as Record<string, unknown> | undefined
  if (!err || typeof err !== 'object') return false
  return err.code === 'MISSING_REQUIRED_FIELD' && typeof err.path === 'string'
}

/**
 * Tiny convenience for handlers that want a single-line return:
 *
 *   return missingRequiredFieldAsResult('sendNotifications')
 *
 * Identical to `missingRequiredField` but typed as ActionResult, hiding the
 * cast from handler code.
 */
export function missingRequiredFieldAsResult(fieldName: string): ActionResult {
  return missingRequiredField(fieldName) as unknown as ActionResult
}
