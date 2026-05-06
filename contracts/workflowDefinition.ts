import { z } from "zod";

/**
 * Structured contract for the workflow definition (nodes + edges).
 *
 * Per docs/rules/workflow-builder-ui.md and workflow-state-store.md: the
 * shape is the source of truth that the builder UI, the variable resolver,
 * and the execution engine all consume. Slice 1H stored a passthrough
 * `unknown` shape; Slice 1I formalizes it.
 *
 * `provider` matches a provider id from the registry (e.g. "slack"). `type`
 * is provider-scoped (e.g. "send_channel_message" for a Slack action) and
 * is the dispatch key the execution engine uses to select a handler. The
 * `config` payload stays opaque here — per-provider Zod schemas live next
 * to the action/trigger handlers (Slice 1L+) and are validated at handler
 * dispatch, not at definition save.
 */

export const WorkflowNodeKindSchema = z.enum(["trigger", "action"]);
export type WorkflowNodeKind = z.infer<typeof WorkflowNodeKindSchema>;

export const WorkflowNodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type WorkflowNodePosition = z.infer<typeof WorkflowNodePositionSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  kind: WorkflowNodeKindSchema,
  /** Provider id from the registry (lowercase, e.g. "slack"). */
  provider: z.string().min(1),
  /**
   * Provider-scoped action/trigger type the execution engine dispatches on.
   * Empty string is allowed transiently while the user has added a node but
   * not yet selected the specific action — the API accepts it but the engine
   * (Slice 1K+) refuses to execute a node without a type.
   */
  type: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
  position: WorkflowNodePositionSchema.default({ x: 0, y: 0 }),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

/**
 * Top-level workflow definition. Stored as `workflows.draft_definition` and
 * snapshotted into `workflow_revisions.definition` on publish.
 *
 * Invariants enforced here:
 *   - At most one trigger node. (V2 supports multi-trigger later; the rule
 *     doc §"Workflow with multiple triggers" defers this.)
 *   - Edge endpoints must reference existing node ids.
 *   - No self-loops; no duplicate edges between the same (from, to) pair.
 *
 * Cycle detection is intentionally NOT enforced here — the builder may
 * compose graphs with retry / loop-back constructs once logic nodes ship.
 * The execution engine (Slice 1K) is responsible for cycle handling.
 */
export const WorkflowDefinitionSchema = z
  .object({
    nodes: z.array(WorkflowNodeSchema).default([]),
    edges: z.array(WorkflowEdgeSchema).default([]),
  })
  .superRefine((def, ctx) => {
    const triggerCount = def.nodes.filter((n) => n.kind === "trigger").length;
    if (triggerCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: "A workflow may have at most one trigger node.",
      });
    }

    const nodeIds = new Set(def.nodes.map((n) => n.id));
    const seenEdgeKeys = new Set<string>();
    for (let i = 0; i < def.edges.length; i++) {
      const edge = def.edges[i]!;
      if (edge.from === edge.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i],
          message: `Edge '${edge.id}' is a self-loop (from === to).`,
        });
      }
      if (!nodeIds.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i, "from"],
          message: `Edge '${edge.id}' references unknown node '${edge.from}'.`,
        });
      }
      if (!nodeIds.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i, "to"],
          message: `Edge '${edge.id}' references unknown node '${edge.to}'.`,
        });
      }
      const key = `${edge.from}->${edge.to}`;
      if (seenEdgeKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i],
          message: `Duplicate edge between '${edge.from}' and '${edge.to}'.`,
        });
      }
      seenEdgeKeys.add(key);
    }

    const ids = new Set<string>();
    for (let i = 0; i < def.nodes.length; i++) {
      const id = def.nodes[i]!.id;
      if (ids.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", i, "id"],
          message: `Duplicate node id '${id}'.`,
        });
      }
      ids.add(id);
    }
  });
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/** Empty definition — the default for newly-created drafts. */
export const EMPTY_WORKFLOW_DEFINITION: WorkflowDefinition = {
  nodes: [],
  edges: [],
};
