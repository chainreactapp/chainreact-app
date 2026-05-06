import { randomUUID } from "node:crypto";
import type { TriggerEvent } from "@/contracts/triggerEvent";
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from "@/contracts/workflow";
import {
  MissingVariableError,
  type ResolveContext,
} from "@/workflow-engine/variables/resolveValue";
import {
  humanizeActionError,
  type HumanizedError,
} from "@/core/errors/humanizeActionError";
import * as workflowsRepo from "@/repositories/workflows";
import * as workflowRunsRepo from "@/repositories/workflowRuns";
import { executionBillingGate } from "@/services/billing/executionBillingGate";
import { getActionHandler } from "./handlers/_registry";

/**
 * Workflow execution engine.
 *
 * Per docs/rules/variable-resolver.md §"Engine pre-resolution (strict)" +
 * webhook-receipt-routes.md §"Async dispatch only":
 *   - The dispatcher already verified state===active and dedup; the engine
 *     trusts that gate and just runs.
 *   - For each non-trigger node in BFS order from the trigger:
 *     1. Resolve config via the injected `resolveStrict`. A
 *        MissingVariableError aborts the run with a config-failure
 *        result for that node — the engine layer owns the catch-and-
 *        convert (rule §"MissingVariableError is thrown by the resolver
 *        and caught at the engine layer").
 *     2. Look up the handler in the registry. Missing → MISSING_HANDLER
 *        run failure.
 *     3. Call the handler with resolved config. Throws → HANDLER_FAILED.
 *     4. Store output in context.variables[nodeId] for downstream nodes.
 *
 * Cycle handling is the visited-set guard inside executionOrder() —
 * workflowDefinition.ts intentionally allows cycles (logic / loop nodes
 * later); for now visited-set prevents infinite loops without rejecting
 * arbitrary graphs.
 *
 * Persistence: at the end of every run that has a workflow loaded, the
 * engine writes one row to workflow_runs with steps + humanized
 * error_classification (Slice 1M). Persistence failures are logged but
 * never propagate — the engine completes the run regardless.
 */

export type RunFailureCode =
  | "WORKFLOW_NOT_FOUND"
  | "TRIGGER_NODE_NOT_FOUND"
  | "BILLING_EXHAUSTED"
  | "MISSING_HANDLER"
  | "MISSING_VARIABLE"
  | "HANDLER_FAILED";

export interface RunStepResult {
  nodeId: string;
  status: "succeeded" | "failed" | "skipped";
  output?: Readonly<Record<string, unknown>>;
  error?: { code: RunFailureCode; message: string; details?: Record<string, unknown> };
}

export interface RunResult {
  runId: string;
  workflowId: string;
  status: "succeeded" | "failed";
  steps: readonly RunStepResult[];
  startedAt: string;
  finishedAt: string;
  /** Top-level failure when the run never reached the per-step loop. */
  fatalError?: { code: RunFailureCode; message: string };
}

export interface RunWorkflowInput {
  workflowId: string;
  triggerNodeId: string;
  triggerEvent: TriggerEvent;
  /** Optional pre-assigned id (the dispatcher's enqueueRun supplies one). */
  runId?: string;
}

export interface EngineDependencies {
  /** Injected so this slice can ship before Slice 1K.1's resolver lands. */
  resolveStrict: (value: unknown, context: ResolveContext) => unknown;
}

export class WorkflowEngine {
  constructor(private readonly deps: EngineDependencies) {}

  async runWorkflow(input: RunWorkflowInput): Promise<RunResult> {
    const runId = input.runId ?? randomUUID();
    const startedAt = new Date().toISOString();
    const log = (event: string, extra: Record<string, unknown> = {}) =>
      console.info(
        JSON.stringify({
          event,
          runId,
          workflowId: input.workflowId,
          ...extra,
        }),
      );

    log("execution.run.started", { triggerNodeId: input.triggerNodeId });

    const workflow = await workflowsRepo.getByIdServiceRole(input.workflowId);
    if (!workflow) {
      const finishedAt = new Date().toISOString();
      log("execution.run.fatal", { code: "WORKFLOW_NOT_FOUND" });
      return {
        runId,
        workflowId: input.workflowId,
        status: "failed",
        steps: [],
        startedAt,
        finishedAt,
        fatalError: {
          code: "WORKFLOW_NOT_FOUND",
          message: `Workflow ${input.workflowId} not found.`,
        },
      };
    }

    const def = workflow.draftDefinition;
    const triggerNode = def.nodes.find((n) => n.id === input.triggerNodeId);
    if (!triggerNode) {
      const finishedAt = new Date().toISOString();
      log("execution.run.fatal", { code: "TRIGGER_NODE_NOT_FOUND" });
      const fatalResult: RunResult = {
        runId,
        workflowId: input.workflowId,
        status: "failed",
        steps: [],
        startedAt,
        finishedAt,
        fatalError: {
          code: "TRIGGER_NODE_NOT_FOUND",
          message: `Trigger node ${input.triggerNodeId} not present in workflow definition.`,
        },
      };
      await persistRun(fatalResult, workflow.userId, input, log);
      return fatalResult;
    }

    // Billing gate (Slice 1N). Atomic deduct via deduct_tasks_if_available;
    // refusal aborts before any handler runs so a quota-exhausted user never
    // produces side effects.
    const gateOutcome = await executionBillingGate(workflow.userId);
    if (!gateOutcome.ok) {
      const finishedAt = new Date().toISOString();
      log("execution.run.fatal", {
        code: "BILLING_EXHAUSTED",
        used: gateOutcome.used,
        limit: gateOutcome.limit,
      });
      const fatalResult: RunResult = {
        runId,
        workflowId: input.workflowId,
        status: "failed",
        steps: [],
        startedAt,
        finishedAt,
        fatalError: {
          code: "BILLING_EXHAUSTED",
          message: `Task quota exhausted: ${gateOutcome.used}/${gateOutcome.limit} tasks used this period.`,
        },
      };
      await persistRun(fatalResult, workflow.userId, input, log);
      return fatalResult;
    }

    // The trigger event is exposed under both 'trigger' (canonical alias used
    // by templates like {{trigger.payload.text}}) and the trigger node's id
    // (so {{<triggerNodeId>.payload.text}} also works).
    const variables: Record<string, unknown> = {
      trigger: input.triggerEvent,
      [triggerNode.id]: input.triggerEvent,
    };

    const order = bfsExecutionOrder(triggerNode.id, def);
    const steps: RunStepResult[] = [];
    let runFailed = false;

    for (const node of order) {
      if (node.kind === "trigger") {
        // The trigger doesn't execute — its payload is the seed. Record
        // it as succeeded for visibility in run history (Slice 1M).
        steps.push({
          nodeId: node.id,
          status: "succeeded",
          output: { event: input.triggerEvent } as Readonly<Record<string, unknown>>,
        });
        continue;
      }

      // 1. Resolve config.
      let resolvedConfig: Readonly<Record<string, unknown>>;
      try {
        const resolved = this.deps.resolveStrict(node.config, { variables });
        resolvedConfig = (resolved ?? {}) as Readonly<Record<string, unknown>>;
      } catch (err) {
        if (err instanceof MissingVariableError) {
          steps.push({
            nodeId: node.id,
            status: "failed",
            error: {
              code: "MISSING_VARIABLE",
              message: err.message,
              details: { path: err.path, reason: err.reason },
            },
          });
          log("execution.step.failed", {
            nodeId: node.id,
            code: "MISSING_VARIABLE",
            path: err.path,
          });
          runFailed = true;
          break;
        }
        // Unexpected resolver error — treat as run-fatal.
        steps.push({
          nodeId: node.id,
          status: "failed",
          error: {
            code: "HANDLER_FAILED",
            message: `Resolver crashed: ${(err as Error).message}`,
          },
        });
        log("execution.step.failed", {
          nodeId: node.id,
          code: "HANDLER_FAILED",
          error: (err as Error).message,
        });
        runFailed = true;
        break;
      }

      // 2. Look up handler.
      const handler = getActionHandler(node.provider, node.type);
      if (!handler) {
        steps.push({
          nodeId: node.id,
          status: "failed",
          error: {
            code: "MISSING_HANDLER",
            message: `No handler registered for ${node.provider}:${node.type}.`,
          },
        });
        log("execution.step.failed", {
          nodeId: node.id,
          code: "MISSING_HANDLER",
          provider: node.provider,
          type: node.type,
        });
        runFailed = true;
        break;
      }

      // 3. Invoke handler.
      try {
        const result = await handler({
          workflowId: input.workflowId,
          userId: workflow.userId,
          runId,
          nodeId: node.id,
          config: resolvedConfig,
          triggerEvent: input.triggerEvent,
        });
        variables[node.id] = result.output;
        steps.push({ nodeId: node.id, status: "succeeded", output: result.output });
        log("execution.step.succeeded", {
          nodeId: node.id,
          provider: node.provider,
          type: node.type,
        });
      } catch (err) {
        steps.push({
          nodeId: node.id,
          status: "failed",
          error: {
            code: "HANDLER_FAILED",
            message: (err as Error).message,
          },
        });
        log("execution.step.failed", {
          nodeId: node.id,
          code: "HANDLER_FAILED",
          error: (err as Error).message,
        });
        runFailed = true;
        break;
      }
    }

    const finishedAt = new Date().toISOString();
    const status: RunResult["status"] = runFailed ? "failed" : "succeeded";
    log("execution.run.finished", { status, stepCount: steps.length });

    const result: RunResult = {
      runId,
      workflowId: input.workflowId,
      status,
      steps,
      startedAt,
      finishedAt,
    };
    await persistRun(result, workflow.userId, input, log);
    return result;
  }
}

/**
 * Write the run row + humanized error_classification. Logs and swallows
 * persistence errors — the engine has done the work; a recordRun crash
 * shouldn't take down the dispatcher.
 *
 * The classification picks the first failed step's error (or the fatal
 * error when there are no steps). One classification per run is enough for
 * the UI's "show what went wrong" surface; per-step error details remain
 * available inside the steps[] payload for deeper diagnostics.
 */
async function persistRun(
  result: RunResult,
  userId: string,
  input: RunWorkflowInput,
  log: (event: string, extra?: Record<string, unknown>) => void,
): Promise<void> {
  const errorClassification = classifyForPersistence(result);
  try {
    await workflowRunsRepo.recordRun({
      runId: result.runId,
      workflowId: result.workflowId,
      userId,
      status: result.status,
      triggerNodeId: input.triggerNodeId,
      triggerEvent: input.triggerEvent,
      steps: result.steps,
      fatalError: result.fatalError ?? null,
      errorClassification,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    });
  } catch (err) {
    log("execution.run.persist_failed", { error: (err as Error).message });
  }
}

function classifyForPersistence(result: RunResult): HumanizedError | null {
  if (result.status === "succeeded") return null;

  // Prefer the first failed step (per-node specificity); fall back to the
  // run-level fatal when no step ran.
  const firstFailed = result.steps.find((s) => s.status === "failed");
  if (firstFailed?.error) {
    return humanizeActionError({
      code: firstFailed.error.code,
      message: firstFailed.error.message,
      ...(firstFailed.error.details !== undefined
        ? { details: firstFailed.error.details }
        : {}),
    });
  }
  if (result.fatalError) {
    return humanizeActionError({
      code: result.fatalError.code,
      message: result.fatalError.message,
    });
  }
  return null;
}

/**
 * Breadth-first execution order starting at the trigger node. The visited
 * set bounds traversal to one visit per node id, so a graph with cycles
 * still terminates (each node executes at most once per run).
 */
function bfsExecutionOrder(
  triggerNodeId: string,
  def: WorkflowDefinition,
): readonly WorkflowNode[] {
  const adjacency = buildAdjacency(def.edges);
  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const order: WorkflowNode[] = [];
  const queue: string[] = [triggerNodeId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodesById.get(id);
    if (node) order.push(node);
    for (const next of adjacency.get(id) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return order;
}

function buildAdjacency(
  edges: readonly WorkflowEdge[],
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    let bucket = map.get(edge.from);
    if (!bucket) {
      bucket = [];
      map.set(edge.from, bucket);
    }
    bucket.push(edge.to);
  }
  return map;
}
