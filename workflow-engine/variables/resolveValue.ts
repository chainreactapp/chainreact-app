/**
 * Canonical V2 variable resolver.
 *
 * Substitutes `{{nodeId.field}}` and `{{AI_FIELD:fieldName}}` template
 * references in workflow node configurations. Strict mode is for engine
 * pre-resolution (throws on missing). Soft mode is for builder / preview /
 * planner (returns undefined or preserves the literal `{{...}}`).
 *
 * Spec: docs/rules/variable-resolver.md.
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

type Mode = "strict" | "soft";

interface ResolveState {
  mode: Mode;
  context: ResolveContext;
  collector?: UnresolvedReference[];
}

export function resolveStrict(
  value: unknown,
  context: ResolveContext,
): unknown {
  return walk(value, { mode: "strict", context });
}

export function resolveSoft(
  value: unknown,
  context: ResolveContext,
  opts: ResolveSoftOptions = {},
): unknown {
  return walk(value, {
    mode: "soft",
    context,
    collector: opts.unresolvedCollector,
  });
}

function walk(value: unknown, state: ResolveState): unknown {
  if (typeof value === "string") {
    return resolveString(value, state);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, state));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = walk(v, state);
    }
    return result;
  }
  return value;
}

interface LiteralSeg {
  kind: "literal";
  text: string;
}
interface TemplateSeg {
  kind: "template";
  content: string;
  raw: string;
}
type Segment = LiteralSeg | TemplateSeg;

function tokenize(input: string): Segment[] {
  const segments: Segment[] = [];
  const len = input.length;
  let i = 0;
  let literalStart = 0;

  const flushLiteral = (end: number): void => {
    if (end > literalStart) {
      segments.push({ kind: "literal", text: input.slice(literalStart, end) });
    }
  };

  while (i < len) {
    if (
      input[i] === "\\" &&
      input[i + 1] === "{" &&
      input[i + 2] === "{"
    ) {
      throw new Error(
        `Escape syntax \\{{...}} is reserved but unimplemented (offset ${i}).`,
      );
    }
    if (input[i] === "{" && input[i + 1] === "{") {
      flushLiteral(i);
      const tokenStart = i;
      i += 2;
      let depth = 1;
      const contentStart = i;
      let contentEnd = -1;
      while (i < len) {
        if (input[i] === "{" && input[i + 1] === "{") {
          depth += 1;
          i += 2;
        } else if (input[i] === "}" && input[i + 1] === "}") {
          depth -= 1;
          if (depth === 0) {
            contentEnd = i;
            i += 2;
            break;
          }
          i += 2;
        } else {
          i += 1;
        }
      }
      if (contentEnd < 0) {
        throw new Error(
          `Unterminated template starting at offset ${tokenStart}: "${input.slice(tokenStart)}"`,
        );
      }
      segments.push({
        kind: "template",
        content: input.slice(contentStart, contentEnd).trim(),
        raw: input.slice(tokenStart, i),
      });
      literalStart = i;
    } else {
      i += 1;
    }
  }
  flushLiteral(len);
  return segments;
}

function resolveString(input: string, state: ResolveState): unknown {
  const segments = tokenize(input);
  if (segments.length === 0) return input;

  if (segments.length === 1) {
    const seg = segments[0];
    if (seg && seg.kind === "literal") return seg.text;
    if (seg && seg.kind === "template") {
      return resolveTemplate(seg.content, state, {
        isStandalone: true,
        originalToken: seg.raw,
      });
    }
  }

  let out = "";
  for (const seg of segments) {
    if (seg.kind === "literal") {
      out += seg.text;
      continue;
    }
    const resolved = resolveTemplate(seg.content, state, {
      isStandalone: false,
      originalToken: seg.raw,
    });
    out += stringifyForMixed(resolved);
  }
  return out;
}

interface ResolveCtx {
  isStandalone: boolean;
  originalToken: string;
}

function resolveTemplate(
  content: string,
  state: ResolveState,
  ctx: ResolveCtx,
): unknown {
  if (content.startsWith("AI_FIELD:")) {
    return resolveAIField(content, state, ctx);
  }
  return resolvePath(content, state, ctx);
}

function resolveAIField(
  content: string,
  state: ResolveState,
  ctx: ResolveCtx,
): unknown {
  const rest = content.slice("AI_FIELD:".length);
  const colonIdx = rest.indexOf(":");
  let fieldName: string;
  let innerExpr: string | undefined;
  if (colonIdx >= 0) {
    fieldName = rest.slice(0, colonIdx).trim();
    innerExpr = rest.slice(colonIdx + 1);
  } else {
    fieldName = rest.trim();
  }

  let resolvedParam: unknown;
  let hasParam = false;
  if (innerExpr !== undefined) {
    resolvedParam = resolveString(innerExpr, state);
    hasParam = true;
  }

  if (state.mode === "strict" && ctx.isStandalone) {
    return hasParam
      ? { __aiField: true, fieldName, resolvedParam }
      : { __aiField: true, fieldName };
  }
  return `[AI_FIELD:${fieldName}]`;
}

function resolvePath(
  pathExpr: string,
  state: ResolveState,
  ctx: ResolveCtx,
): unknown {
  const tokens = tokenizePath(pathExpr);
  const result = lookupPath(tokens, state.context.variables);
  if (result.kind === "missing") {
    if (state.collector) {
      state.collector.push({ path: pathExpr, reason: result.reason });
    }
    if (state.mode === "strict") {
      throw new MissingVariableError(pathExpr, result.reason);
    }
    return ctx.isStandalone ? undefined : ctx.originalToken;
  }
  return result.value;
}

type PathToken =
  | { kind: "prop"; name: string }
  | { kind: "index"; index: number };

function tokenizePath(input: string): PathToken[] {
  const tokens: PathToken[] = [];
  let buf = "";
  let i = 0;
  const flushBuf = (): void => {
    if (buf.length > 0) {
      tokens.push({ kind: "prop", name: buf });
      buf = "";
    }
  };
  while (i < input.length) {
    const c = input[i];
    if (c === ".") {
      flushBuf();
      i += 1;
    } else if (c === "[") {
      flushBuf();
      const closeIdx = input.indexOf("]", i + 1);
      if (closeIdx === -1) {
        throw new Error(`Unterminated [ in path "${input}"`);
      }
      const idxStr = input.slice(i + 1, closeIdx).trim();
      if (!/^\d+$/.test(idxStr)) {
        throw new Error(
          `Invalid array index "[${idxStr}]" in path "${input}"`,
        );
      }
      tokens.push({ kind: "index", index: Number.parseInt(idxStr, 10) });
      i = closeIdx + 1;
    } else if (c !== undefined) {
      buf += c;
      i += 1;
    } else {
      i += 1;
    }
  }
  flushBuf();
  return tokens;
}

type LookupResult =
  | { kind: "ok"; value: unknown }
  | { kind: "missing"; reason: MissingVariableReason };

function lookupPath(
  tokens: PathToken[],
  vars: Record<string, unknown>,
): LookupResult {
  if (tokens.length === 0) {
    return { kind: "missing", reason: "missing_node" };
  }
  const first = tokens[0];
  if (!first || first.kind !== "prop") {
    return { kind: "missing", reason: "missing_node" };
  }
  if (
    !Object.prototype.hasOwnProperty.call(vars, first.name) ||
    vars[first.name] === undefined
  ) {
    return { kind: "missing", reason: "missing_node" };
  }
  let current: unknown = vars[first.name];

  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!tok) continue;
    if (tok.kind === "prop") {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        return { kind: "missing", reason: "missing_field" };
      }
      const obj = current as Record<string, unknown>;
      if (
        !Object.prototype.hasOwnProperty.call(obj, tok.name) ||
        obj[tok.name] === undefined
      ) {
        return { kind: "missing", reason: "missing_field" };
      }
      current = obj[tok.name];
    } else {
      if (!Array.isArray(current)) {
        return { kind: "missing", reason: "missing_field" };
      }
      if (tok.index < 0 || tok.index >= current.length) {
        return { kind: "missing", reason: "array_out_of_bounds" };
      }
      const elem = current[tok.index];
      if (elem === undefined) {
        return { kind: "missing", reason: "missing_field" };
      }
      current = elem;
    }
  }
  return { kind: "ok", value: current };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function stringifyForMixed(value: unknown): string {
  if (value === undefined) return "";
  return String(value);
}
