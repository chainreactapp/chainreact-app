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
