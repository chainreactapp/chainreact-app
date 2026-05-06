import { TriggerEventSchema } from "@/contracts/triggerEvent";

describe("TriggerEventSchema", () => {
  const valid = {
    provider: "slack",
    eventType: "message_received",
    eventId: "Ev123",
    occurredAt: "2026-05-07T00:00:00Z",
    accountId: "T0001",
    payload: { channel: "C123", text: "hi" },
  };

  it("accepts a complete event from a normalized provider payload", () => {
    expect(TriggerEventSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty required strings (each field is the dispatch key for a different routing decision)", () => {
    for (const field of [
      "provider",
      "eventType",
      "eventId",
      "occurredAt",
      "accountId",
    ] as const) {
      const candidate = { ...valid, [field]: "" };
      const result = TriggerEventSchema.safeParse(candidate);
      expect(result.success).toBe(false);
    }
  });

  it("accepts an empty payload object", () => {
    const r = TriggerEventSchema.safeParse({ ...valid, payload: {} });
    expect(r.success).toBe(true);
  });

  it("rejects a non-object payload (must be a record so action handlers can index into it)", () => {
    expect(
      TriggerEventSchema.safeParse({ ...valid, payload: "string" }).success,
    ).toBe(false);
    expect(
      TriggerEventSchema.safeParse({ ...valid, payload: ["array"] }).success,
    ).toBe(false);
  });
});
