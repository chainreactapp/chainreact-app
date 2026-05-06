import { z } from "zod";

/**
 * Cross-layer workflow contracts.
 *
 * Per docs/rules/workflow-lifecycle.md (Resolved Decisions):
 *   - Six lifecycle states: draft, active, paused, disabled, eligible_to_resume, deleted.
 *   - Soft-delete is the `deleted` lifecycle state itself, not a separate flag.
 *   - `disabled_reason` is a typed enum + optional context string.
 */

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
 * The shape stored in `workflows.draft_definition` and `workflow_revisions.definition`.
 * Slice 1H stores an opaque JSON object so the schema can evolve with the builder
 * (Slice 1I+); a strict shape will be enforced by `contracts/workflow-definition.ts`
 * once nodes / edges are formalized.
 */
export const WorkflowDefinitionSchema = z
  .object({
    nodes: z.array(z.unknown()).default([]),
    edges: z.array(z.unknown()).default([]),
  })
  .passthrough();
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

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
