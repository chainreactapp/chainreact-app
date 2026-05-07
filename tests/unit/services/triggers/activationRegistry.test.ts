/**
 * @jest-environment node
 */

import {
  __resetActivationRegistryForTests,
  findActivation,
  registerActivation,
} from "@/services/triggers/activationRegistry";

beforeEach(() => {
  __resetActivationRegistryForTests();
});

describe("activationRegistry", () => {
  it("returns null when no activation is registered for (provider, eventType)", () => {
    expect(findActivation("gmail", "new_email")).toBeNull();
  });

  it("returns the registered fn for an exact (provider, eventType) match", async () => {
    const fn = jest.fn(async () => ({ snapshot: { historyId: "42" } }));
    registerActivation("gmail", "new_email", fn);
    const found = findActivation("gmail", "new_email");
    expect(found).toBe(fn);
    expect(findActivation("gmail", "new_label")).toBeNull();
    expect(findActivation("slack", "new_email")).toBeNull();
  });

  it("throws on duplicate registration of the same (provider, eventType)", () => {
    registerActivation("gmail", "new_email", async () => ({}));
    expect(() =>
      registerActivation("gmail", "new_email", async () => ({})),
    ).toThrow(/duplicate registration/i);
  });
});
