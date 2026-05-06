/**
 * @jest-environment node
 *
 * Tests for services/execution/handlers/_registry.ts.
 *
 * Slice 1L registered the first handler (slack:send_channel_message).
 * Future provider slices append entries; this test pins the contract that
 * survives provider additions.
 */
import {
  getActionHandler,
  listRegisteredHandlers,
} from "@/services/execution/handlers/_registry";

describe("action handler registry", () => {
  it("returns the Slack send_channel_message handler (registered in 1L)", () => {
    expect(getActionHandler("slack", "send_channel_message")).toBeDefined();
  });

  it("returns undefined for (provider, type) pairs that no slice has registered yet", () => {
    expect(getActionHandler("gmail", "send_email")).toBeUndefined();
    expect(getActionHandler("slack", "create_channel")).toBeUndefined();
  });

  it("listRegisteredHandlers includes Slack send_channel_message", () => {
    const registered = listRegisteredHandlers();
    expect(registered).toContainEqual({
      provider: "slack",
      type: "send_channel_message",
    });
  });

  it("the lookup namespace is (provider, type) — same type from different providers does not collide", () => {
    expect(getActionHandler("gmail", "send_channel_message")).toBeUndefined();
  });
});
