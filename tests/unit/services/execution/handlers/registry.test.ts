/**
 * @jest-environment node
 *
 * Tests for services/execution/handlers/_registry.ts.
 *
 * Slice 1K.2 ships an empty registry by design — the engine's
 * MISSING_HANDLER path is exercised in engine tests. Slice 1L will add
 * Slack handlers; this file's tests document the contract that survives.
 */
import {
  getActionHandler,
  listRegisteredHandlers,
} from "@/services/execution/handlers/_registry";

describe("action handler registry", () => {
  it("returns undefined for unregistered (provider, type) pairs", () => {
    expect(getActionHandler("slack", "send_channel_message")).toBeUndefined();
    expect(getActionHandler("gmail", "send_email")).toBeUndefined();
  });

  it("listRegisteredHandlers reflects the current static set (empty in Slice 1K.2)", () => {
    expect(listRegisteredHandlers()).toEqual([]);
  });

  it("the lookup namespace is (provider, type) — same type from different providers does not collide", () => {
    // Both lookups go through the same map without conflicting; both
    // return undefined now, but the contract is "namespaced by provider."
    expect(getActionHandler("slack", "send")).toBeUndefined();
    expect(getActionHandler("gmail", "send")).toBeUndefined();
  });
});
