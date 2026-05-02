/**
 * Parse a recipient/multi-value field into a normalized array of strings.
 *
 * Contract: see `learning/docs/handler-contracts.md` Q7.
 *
 * Used by handlers whose schema declares a field as multi-recipient /
 * multi-value (Gmail `to`/`cc`/`bcc`, Outlook `to`/`cc`/`bcc`, Calendar
 * `attendees`, etc.). Single-value fields MUST NOT route through this helper —
 * their schemas do not declare CSV semantics.
 *
 * Behavior:
 *   - `undefined` / `null` / `""` → `[]`
 *   - `"a@x.com"` → `["a@x.com"]`
 *   - `"a@x.com, b@x.com,c@x.com"` → `["a@x.com", "b@x.com", "c@x.com"]`
 *   - `["a@x.com", " b@x.com "]` → `["a@x.com", "b@x.com"]`
 *   - Whitespace is trimmed; empty fragments are dropped.
 *
 * Out of scope (Q7):
 *   - RFC 5322 display-name parsing. `"Last, First" <x@y.com>` is treated as
 *     two CSV entries because the simple comma-split has no concept of quoted
 *     display names. Users supply plain emails / IDs separated by commas, or
 *     arrays.
 *   - Per-entry validation. The caller (handler) is responsible for any
 *     additional checks (e.g., Calendar `createEvent` filters non-`@` entries).
 */
export function parseRecipients(input: string | string[] | undefined | null): string[] {
  if (input === undefined || input === null) {
    return []
  }

  const flat: string[] = Array.isArray(input)
    ? input.flatMap(item => (typeof item === 'string' ? item.split(',') : []))
    : input.split(',')

  return flat.map(s => s.trim()).filter(s => s.length > 0)
}
