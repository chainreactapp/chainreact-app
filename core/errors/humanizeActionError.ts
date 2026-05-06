/**
 * Pure humanizer for engine + handler errors.
 *
 * Converts the engine's failure codes (MISSING_VARIABLE, MISSING_HANDLER,
 * HANDLER_FAILED, WORKFLOW_NOT_FOUND, TRIGGER_NODE_NOT_FOUND) and the
 * provider-specific Slack codes (channel_not_found, not_in_channel,
 * invalid_auth, http_<status>, …) into a user-facing
 * {title, description, hint?, action?, severity} shape.
 *
 * Lives in core/ because it has zero I/O and is consumed by both the
 * engine (writes the classification on the workflow_runs row) and the
 * UI (renders run history). Per project-structure §"Error humanization":
 * core/errors/humanizeActionError.ts.
 *
 * Action codes route the UI's CTA button:
 *   - reconnect    → /integrations
 *   - open_node    → builder with the failed node focused
 *   - upgrade_plan → /subscription (Slice 1N billing)
 */

export interface HumanizedError {
  title: string;
  description: string;
  hint?: string;
  action?: "reconnect" | "open_node" | "upgrade_plan";
  severity: "warning" | "error";
}

export interface ErrorInput {
  /**
   * Engine code (MISSING_VARIABLE, MISSING_HANDLER, HANDLER_FAILED,
   * WORKFLOW_NOT_FOUND, TRIGGER_NODE_NOT_FOUND) OR a provider-specific
   * code surfaced by a handler.
   */
  code: string;
  /** The raw error message from the engine or handler. */
  message: string;
  /** Engine-supplied details (e.g. { path, reason } for MISSING_VARIABLE). */
  details?: Readonly<Record<string, unknown>>;
}

export function humanizeActionError(input: ErrorInput): HumanizedError {
  const engineHumanized = humanizeEngineCode(input);
  if (engineHumanized) return engineHumanized;

  const slackHumanized = humanizeSlackHandlerError(input);
  if (slackHumanized) return slackHumanized;

  return {
    title: "Workflow step failed",
    description: input.message || "An unexpected error occurred.",
    severity: "error",
  };
}

function humanizeEngineCode(input: ErrorInput): HumanizedError | null {
  switch (input.code) {
    case "MISSING_VARIABLE": {
      const path = stringField(input.details, "path");
      const reason = stringField(input.details, "reason");
      const reasonHint =
        reason === "missing_node"
          ? "The referenced step hasn't run yet, or its node id changed."
          : reason === "array_out_of_bounds"
            ? "The referenced array index is past the end of the data."
            : "The referenced field is missing from the upstream data.";
      return {
        title: "Variable reference can't be resolved",
        description: path
          ? `Couldn't resolve {{${path}}} when running this step.`
          : "A {{...}} reference in this step couldn't be resolved.",
        hint: reasonHint,
        action: "open_node",
        severity: "error",
      };
    }
    case "MISSING_HANDLER":
      return {
        title: "No handler for this action",
        description:
          input.message ||
          "The action type configured on this node isn't recognized by the engine.",
        hint: "Pick a supported action type, or remove this node.",
        action: "open_node",
        severity: "error",
      };
    case "WORKFLOW_NOT_FOUND":
      return {
        title: "Workflow not found",
        description:
          "The workflow was deleted while a webhook event was waiting to dispatch.",
        severity: "warning",
      };
    case "TRIGGER_NODE_NOT_FOUND":
      return {
        title: "Trigger node missing",
        description:
          "The webhook fired a trigger node that no longer exists in the workflow definition. The workflow may have been edited after the event arrived.",
        hint: "Re-save the workflow to refresh trigger registration.",
        action: "open_node",
        severity: "warning",
      };
    case "BILLING_EXHAUSTED":
      return {
        title: "Task quota exhausted",
        description:
          input.message ||
          "You've reached your task quota for this billing period.",
        hint: "Upgrade your plan to keep workflows running.",
        action: "upgrade_plan",
        severity: "warning",
      };
    case "HANDLER_FAILED":
      // Slack-ish messages get further refinement below.
      return null;
    default:
      return null;
  }
}

function humanizeSlackHandlerError(input: ErrorInput): HumanizedError | null {
  const slackCode = extractSlackCode(input.message);
  if (!slackCode) return null;

  // Auth-related codes route to Reconnect.
  if (
    slackCode === "invalid_auth" ||
    slackCode === "token_revoked" ||
    slackCode === "token_expired" ||
    slackCode === "account_inactive" ||
    slackCode === "not_authed"
  ) {
    return {
      title: "Slack needs to be reconnected",
      description:
        "Slack rejected the bot token — usually because the workspace removed the app or the OAuth flow needs to be re-run.",
      hint: "Reconnect Slack on the integrations page; the workflow stays paused until that's done.",
      action: "reconnect",
      severity: "error",
    };
  }

  if (slackCode === "channel_not_found") {
    return {
      title: "Slack channel not found",
      description:
        "Slack couldn't find the channel id this step is trying to post to.",
      hint: "Double-check the channel id and that the bot is a member.",
      action: "open_node",
      severity: "error",
    };
  }
  if (slackCode === "not_in_channel" || slackCode === "is_archived") {
    return {
      title: "Slack channel access lost",
      description:
        slackCode === "is_archived"
          ? "The Slack channel has been archived."
          : "The Slack bot has been removed from this channel.",
      hint:
        slackCode === "is_archived"
          ? "Pick a different channel or unarchive the existing one."
          : "Re-invite the bot to the channel and try again.",
      action: "open_node",
      severity: "error",
    };
  }

  if (slackCode === "rate_limited" || slackCode === "http_429") {
    return {
      title: "Slack rate limit hit",
      description:
        "Slack has temporarily throttled this app. The workflow will retry shortly.",
      severity: "warning",
    };
  }

  if (slackCode.startsWith("http_")) {
    return {
      title: "Slack API error",
      description: `Slack returned ${slackCode.replace("http_", "HTTP ")}.`,
      hint: "Try again in a moment; if it persists, check Slack's status page.",
      severity: "warning",
    };
  }

  // Unknown Slack code — fall back to a generic Slack message rather than the
  // raw "Slack chat.postMessage failed: <code>" string.
  return {
    title: "Slack action failed",
    description: `Slack reported: ${slackCode}`,
    severity: "error",
  };
}

const SLACK_PREFIX = "Slack chat.postMessage failed: ";

function extractSlackCode(message: string): string | null {
  if (!message.startsWith(SLACK_PREFIX)) return null;
  const code = message.slice(SLACK_PREFIX.length).trim();
  return code.length > 0 ? code : null;
}

function stringField(
  details: ErrorInput["details"],
  key: string,
): string | null {
  if (!details) return null;
  const value = details[key];
  return typeof value === "string" ? value : null;
}
