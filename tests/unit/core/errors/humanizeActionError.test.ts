/**
 * Tests for core/errors/humanizeActionError.
 *
 * Pure function. Covers every engine code, the Slack-specific extractors,
 * and the generic fallback shape so the run-history UI never displays a
 * raw "Slack chat.postMessage failed: x" string.
 */
import { humanizeActionError } from "@/core/errors/humanizeActionError";

describe("humanizeActionError — engine codes", () => {
  it("MISSING_VARIABLE includes the failed path + reason hint + open_node action", () => {
    const result = humanizeActionError({
      code: "MISSING_VARIABLE",
      message: "Missing variable: trigger.unknown (missing_field)",
      details: { path: "trigger.unknown", reason: "missing_field" },
    });
    expect(result.title).toMatch(/variable/i);
    expect(result.description).toContain("trigger.unknown");
    expect(result.hint).toMatch(/upstream data/i);
    expect(result.action).toBe("open_node");
    expect(result.severity).toBe("error");
  });

  it("MISSING_VARIABLE missing_node hint differs from missing_field hint", () => {
    const node = humanizeActionError({
      code: "MISSING_VARIABLE",
      message: "x",
      details: { path: "step1.x", reason: "missing_node" },
    });
    const field = humanizeActionError({
      code: "MISSING_VARIABLE",
      message: "x",
      details: { path: "step1.x", reason: "missing_field" },
    });
    expect(node.hint).not.toBe(field.hint);
  });

  it("MISSING_VARIABLE array_out_of_bounds has its own hint", () => {
    const result = humanizeActionError({
      code: "MISSING_VARIABLE",
      message: "x",
      details: { path: "items[5]", reason: "array_out_of_bounds" },
    });
    expect(result.hint).toMatch(/array/i);
  });

  it("MISSING_HANDLER suggests picking a supported action type", () => {
    const result = humanizeActionError({
      code: "MISSING_HANDLER",
      message: "No handler registered for slack:unknown_thing.",
    });
    expect(result.action).toBe("open_node");
    expect(result.severity).toBe("error");
  });

  it("WORKFLOW_NOT_FOUND is a warning (not an error) — race between event arrival and workflow deletion", () => {
    const result = humanizeActionError({
      code: "WORKFLOW_NOT_FOUND",
      message: "Workflow X not found.",
    });
    expect(result.severity).toBe("warning");
  });

  it("TRIGGER_NODE_NOT_FOUND suggests resaving the workflow", () => {
    const result = humanizeActionError({
      code: "TRIGGER_NODE_NOT_FOUND",
      message: "Trigger node n1 not present.",
    });
    expect(result.action).toBe("open_node");
    expect(result.hint).toMatch(/re-?save/i);
  });
});

describe("humanizeActionError — Slack handler errors (HANDLER_FAILED routing)", () => {
  function slack(code: string) {
    return humanizeActionError({
      code: "HANDLER_FAILED",
      message: `Slack chat.postMessage failed: ${code}`,
    });
  }

  it("invalid_auth → reconnect action", () => {
    const r = slack("invalid_auth");
    expect(r.action).toBe("reconnect");
    expect(r.title).toMatch(/reconnected/i);
  });

  it.each(["token_revoked", "token_expired", "account_inactive", "not_authed"])(
    "%s → reconnect action",
    (code) => {
      expect(slack(code).action).toBe("reconnect");
    },
  );

  it("channel_not_found → open_node, hints to check the channel id", () => {
    const r = slack("channel_not_found");
    expect(r.action).toBe("open_node");
    expect(r.hint).toMatch(/channel id|member/i);
  });

  it("not_in_channel → re-invite hint, open_node", () => {
    const r = slack("not_in_channel");
    expect(r.action).toBe("open_node");
    expect(r.hint).toMatch(/re-?invite/i);
  });

  it("is_archived → archived-channel description distinct from not_in_channel", () => {
    const archived = slack("is_archived");
    const notIn = slack("not_in_channel");
    expect(archived.description).not.toBe(notIn.description);
  });

  it("rate_limited and http_429 are warnings (engine retries via the queue, future)", () => {
    expect(slack("rate_limited").severity).toBe("warning");
    expect(slack("http_429").severity).toBe("warning");
  });

  it("http_500 is a warning with a 'Slack status page' hint", () => {
    const r = slack("http_500");
    expect(r.severity).toBe("warning");
    expect(r.hint).toMatch(/status page/i);
  });

  it("unknown Slack code falls back to a generic 'Slack reported: <code>' description", () => {
    const r = slack("some_new_code");
    expect(r.description).toMatch(/some_new_code/);
  });
});

describe("humanizeActionError — fallback", () => {
  it("returns a generic shape for unknown codes", () => {
    const r = humanizeActionError({ code: "MYSTERY", message: "boom" });
    expect(r.title).toBe("Workflow step failed");
    expect(r.description).toBe("boom");
    expect(r.severity).toBe("error");
  });

  it("uses a default description when message is empty", () => {
    const r = humanizeActionError({ code: "MYSTERY", message: "" });
    expect(r.description).toMatch(/unexpected/i);
  });

  it("HANDLER_FAILED with a non-Slack message falls through to the generic shape", () => {
    const r = humanizeActionError({
      code: "HANDLER_FAILED",
      message: "Some other handler exploded.",
    });
    expect(r.title).toBe("Workflow step failed");
    expect(r.description).toBe("Some other handler exploded.");
  });
});
