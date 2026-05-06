import { z } from "zod";
import { WorkflowDefinitionSchema } from "./workflowDefinition";

/**
 * Cross-layer workflow contracts.
 *
 * Per docs/rules/workflow-lifecycle.md (Resolved Decisions):
 *   - Six lifecycle states: draft, active, paused, disabled, eligible_to_resume, deleted.
 *   - Soft-delete is the `deleted` lifecycle state itself, not a separate flag.
 *   - `disabled_reason` is a typed enum + optional context string.
 *
 * The structured node + edge schemas live in `contracts/workflowDefinition.ts`
 * (Slice 1I). This file re-exports the type so existing imports keep working.
 */
export {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  WorkflowNodeSchema,
  type WorkflowNode,
  WorkflowEdgeSchema,
  type WorkflowEdge,
  WorkflowNodeKindSchema,
  type WorkflowNodeKind,
  EMPTY_WORKFLOW_DEFINITION,
} from "./workflowDefinition";

export const WorkflowStateSchema = z.enum([
  "draft",
  "active",
  "paused",
  "disabled",
  "eligible_to_resume",
  "deleted",
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const WorkflowDisabledReasonSchema = z.enum([
  "integration_revoked",
  "billing_exhausted",
  "repeated_failure",
  "manual_admin",
]);
export type WorkflowDisabledReason = z.infer<typeof WorkflowDisabledReasonSchema>;


/**
 * Wire shape returned by the workflow API endpoints. Excludes server-only
 * fields like the full draft_definition, user_id, and active_revision_id —
 * the list / lifecycle endpoints don't need them. The edit page (Slice 1H.4+)
 * loads the full record via a dedicated endpoint.
 */
export const WorkflowSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  state: WorkflowStateSchema,
  disabledReason: WorkflowDisabledReasonSchema.nullable(),
  disabledContext: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>;

// ── API request schemas ─────────────────────────────────────────────────────

export const CreateWorkflowRequestSchema = z.object({
  name: z.string().trim().min(1, "Workflow name is required.").max(120),
});
export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;

export const DisableWorkflowRequestSchema = z.object({
  reason: WorkflowDisabledReasonSchema,
  context: z.string().max(500).optional(),
});
export type DisableWorkflowRequest = z.infer<typeof DisableWorkflowRequestSchema>;

/**
 * Detailed wire shape returned by GET / PATCH /api/workflows/[id]. Extends
 * WorkflowSummary with the editable definition + active revision pointer
 * needed by the edit page (Slice 1H.4) and the builder UI (Slice 1I+).
 */
export const WorkflowDetailSchema = WorkflowSummarySchema.extend({
  activeRevisionId: z.string().uuid().nullable(),
  draftDefinition: WorkflowDefinitionSchema,
});
export type WorkflowDetail = z.infer<typeof WorkflowDetailSchema>;

/**
 * Wire shape for the run-history list (Slice 1M.2). Light by design —
 * strips user_id, the full trigger_event payload, the per-step results,
 * and run-fatal details. The list view only needs status + timestamps +
 * humanized error_classification. A future "run detail" endpoint serves
 * the full record when we add per-run drill-down.
 */
export const WorkflowRunStatusSchema = z.enum(["succeeded", "failed"]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const HumanizedErrorSchema = z.object({
  title: z.string(),
  description: z.string(),
  hint: z.string().optional(),
  action: z.enum(["reconnect", "open_node", "upgrade_plan"]).optional(),
  severity: z.enum(["warning", "error"]),
});
export type HumanizedErrorSummary = z.infer<typeof HumanizedErrorSchema>;

export const WorkflowRunSummarySchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  status: WorkflowRunStatusSchema,
  triggerNodeId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  errorClassification: HumanizedErrorSchema.nullable(),
});
export type WorkflowRunSummary = z.infer<typeof WorkflowRunSummarySchema>;

/**
 * PATCH /api/workflows/[id] body. Slice 1I extended this beyond name-only
 * to accept the full `draftDefinition` so the builder can save graph edits.
 * The orchestrator owns lifecycle transitions via the dedicated action
 * endpoints — `state` is intentionally NOT editable here.
 */
export const UpdateWorkflowRequestSchema = z
  .object({
    name: z.string().trim().min(1, "Workflow name is required.").max(120).optional(),
    draftDefinition: WorkflowDefinitionSchema.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.draftDefinition !== undefined,
    { message: "At least one field must be provided." },
  );
export type UpdateWorkflowRequest = z.infer<typeof UpdateWorkflowRequestSchema>;
