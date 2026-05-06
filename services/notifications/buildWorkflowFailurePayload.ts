import type { HumanizedError } from "@/core/errors/humanizeActionError";

/**
 * Pure payload builder for workflow-failure notifications.
 *
 * One shape consumed by every channel (in-app, email, Slack, Discord, SMS).
 * Channels render this into their own format (in-app row, HTML email, Slack
 * block kit, Discord embed, SMS string) but never re-derive the CTA URL or
 * the body text — that's centralized here so the user sees consistent
 * messaging across surfaces.
 *
 * Per V2 notifications platform plan §1 (Target architecture) — the builder
 * is pure (no I/O, no clients) so channels are trivially testable and the
 * payload is deterministic given the same input.
 */

export interface WorkflowFailurePayload {
  workflowId: string;
  workflowName: string;
  runId: string;
  errorClassification: HumanizedError;
  /** App-internal URL the channel CTA links to. Provider-specific channels
   *  (email, Slack, Discord) will prefix with the deployment's public origin. */
  ctaUrl: string;
  ctaLabel: string;
}

export interface BuildWorkflowFailurePayloadInput {
  workflowId: string;
  workflowName: string;
  runId: string;
  errorClassification: HumanizedError;
}

export function buildWorkflowFailurePayload(
  input: BuildWorkflowFailurePayloadInput,
): WorkflowFailurePayload {
  return {
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    runId: input.runId,
    errorClassification: input.errorClassification,
    ctaUrl: ctaUrlFor(input.errorClassification.action, input.workflowId, input.runId),
    ctaLabel: ctaLabelFor(input.errorClassification.action),
  };
}

/**
 * Action → CTA URL routing. Mirrors the humanizer's action enum so a
 * single classified failure surfaces a consistent CTA across channels.
 *
 * Defaults (no action set on the humanized error) → run-history fallback,
 * mirroring V1's "if action is null, deep-link to history" behavior.
 */
function ctaUrlFor(
  action: HumanizedError["action"],
  workflowId: string,
  runId: string,
): string {
  switch (action) {
    case "reconnect":
      return "/integrations";
    case "upgrade_plan":
      return "/subscription";
    case "open_node":
    case undefined:
      return `/workflows/${workflowId}?historyRun=${runId}`;
  }
}

function ctaLabelFor(action: HumanizedError["action"]): string {
  switch (action) {
    case "reconnect":
      return "Reconnect";
    case "upgrade_plan":
      return "Upgrade plan";
    case "open_node":
      return "View workflow";
    case undefined:
      return "View run";
  }
}

/**
 * Plain-text body shared across channels: description + hint inlined when
 * present. Hint is the load-bearing action recommendation ("Reconnect Slack",
 * "Pick a different channel") — it always pairs with the description.
 *
 * Channels that have richer rendering (email HTML, Slack blocks) may break
 * this back into separate fields by reading payload.errorClassification
 * directly; this helper exists for one-text-blob channels (SMS, in-app
 * body, plain-text email).
 */
export function buildPlainTextBody(err: HumanizedError): string {
  if (err.hint) return `${err.description} ${err.hint}`;
  return err.description;
}
