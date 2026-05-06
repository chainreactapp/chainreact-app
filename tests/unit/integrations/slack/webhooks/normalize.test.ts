import { normalizeSlackEvent } from "@/integrations/slack/webhooks/normalize";

const baseSlackPayload = {
  type: "event_callback" as const,
  team_id: "T0001",
  event_id: "Ev123",
  event_time: 1730000000,
  event: {
    type: "message",
    channel: "C123",
    user: "U1",
    text: "hi",
  },
};

describe("normalizeSlackEvent", () => {
  it("maps the Slack envelope to the canonical TriggerEvent shape", () => {
    const result = normalizeSlackEvent(baseSlackPayload);
    expect(result).toEqual({
      provider: "slack",
      eventType: "message",
      eventId: "Ev123",
      occurredAt: new Date(1730000000 * 1000).toISOString(),
      accountId: "T0001",
      payload: baseSlackPayload.event,
    });
  });

  it("preserves the inner event object verbatim as `payload` (action handlers index into it)", () => {
    const richEvent = {
      ...baseSlackPayload,
      event: {
        type: "message",
        channel: "C456",
        user: "U2",
        text: "hello world",
        ts: "1234567890.123",
        thread_ts: "1234567890.000",
      },
    };
    const result = normalizeSlackEvent(richEvent);
    expect(result.payload).toEqual(richEvent.event);
  });

  it("uses Slack's event.type as the canonical eventType (no translation table)", () => {
    const channelCreated = {
      ...baseSlackPayload,
      event: { type: "channel_created", channel: "C999" },
    };
    expect(normalizeSlackEvent(channelCreated).eventType).toBe("channel_created");
  });

  it("is pure: same input -> same output, no side effects", () => {
    const a = normalizeSlackEvent(baseSlackPayload);
    const b = normalizeSlackEvent(baseSlackPayload);
    expect(a).toEqual(b);
  });

  it("throws (Zod) when the inner event has no type — defense-in-depth before dispatch", () => {
    const invalid = {
      ...baseSlackPayload,
      event: { type: "", channel: "C1" },
    };
    expect(() => normalizeSlackEvent(invalid)).toThrow();
  });
});
