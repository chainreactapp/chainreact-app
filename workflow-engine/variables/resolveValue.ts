/**
 * STUB — Slice 1K.1 (variable resolver) is being implemented in a parallel
 * chat. The contract below is locked per the handoff brief; the parallel
 * slice replaces every function body with the real implementation.
 *
 * Slice 1K.2 (this slice) writes the engine against this contract via
 * dependency injection so the engine + tests are complete without the
 * resolver being landed yet. Production execution paths that hit the stub
 * throw the "not implemented" error below — by design, until 1K.1 ships.
 *
 * DO NOT change the exported types or signatures here without coordinating
 * with the parallel chat — the brief's contract section is the source of
 * truth for both slices.
 */

export interface ResolveContext {
  variables: Readonly<Record<string, unknown>>;
}

export type MissingVariableReason =
  | "missing_node"
  | "missing_field"
  | "array_out_of_bounds";

export class MissingVariableError extends Error {
  readonly path: string;
  readonly reason: MissingVariableReason;
  constructor(path: string, reason: MissingVariableReason) {
    super(`Missing variable: ${path} (${reason})`);
    this.name = "MissingVariableError";
    this.path = path;
    this.reason = reason;
  }
}

export interface AIFieldRef {
  readonly __aiField: true;
  readonly fieldName: string;
  readonly resolvedParam?: unknown;
}

export interface UnresolvedReference {
  path: string;
  reason: MissingVariableReason;
}

export interface ResolveSoftOptions {
  unresolvedCollector?: UnresolvedReference[];
}

const NOT_IMPLEMENTED =
  "Variable resolver not yet implemented — Slice 1K.1 ships in a parallel commit.";

export function resolveStrict(
  _value: unknown,
  _context: ResolveContext,
): unknown {
  throw new Error(NOT_IMPLEMENTED);
}

export function resolveSoft(
  _value: unknown,
  _context: ResolveContext,
  _opts?: ResolveSoftOptions,
): unknown {
  throw new Error(NOT_IMPLEMENTED);
}
