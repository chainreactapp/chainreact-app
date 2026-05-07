/**
 * @jest-environment node
 */

import {
  __resetPollingRegistryForTests,
  findPollingHandler,
  registerPollingHandler,
} from "@/services/triggers/pollingRegistry";
import type { TriggerResourceRecord } from "@/repositories/triggerResources";

function makeTrigger(provider: string): TriggerResourceRecord {
  return {
    id: "tr-1",
    workflowId: "wf-1",
    userId: "user-1",
    provider,
    eventType: "new_email",
    nodeId: "n1",
    config: { pollingEnabled: true },
    accountId: null,
    registeredAt: "2026-05-07T00:00:00Z",
    expiresAt: null,
    lastRenewedAt: null,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
  };
}

beforeEach(() => {
  __resetPollingRegistryForTests();
});

describe("pollingRegistry", () => {
  it("returns null when no handler matches", () => {
    expect(findPollingHandler(makeTrigger("gmail"))).toBeNull();
  });

  it("returns the first handler whose canHandle returns true", () => {
    const gmail = {
      id: "gmail",
      canHandle: (t: TriggerResourceRecord) => t.provider === "gmail",
      getIntervalMs: () => 1000,
      poll: jest.fn(),
    };
    const slack = {
      id: "slack",
      canHandle: (t: TriggerResourceRecord) => t.provider === "slack",
      getIntervalMs: () => 1000,
      poll: jest.fn(),
    };
    registerPollingHandler(gmail);
    registerPollingHandler(slack);
    expect(findPollingHandler(makeTrigger("gmail"))).toBe(gmail);
    expect(findPollingHandler(makeTrigger("slack"))).toBe(slack);
    expect(findPollingHandler(makeTrigger("notion"))).toBeNull();
  });
});
