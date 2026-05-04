import { humanizeActionError } from "@/lib/workflows/errors/humanizeActionError"

describe("humanizeActionError", () => {
  describe("category: auth", () => {
    it("uses provider display name and reconnect CTA", () => {
      const out = humanizeActionError({
        category: "auth",
        provider: "gmail",
        error: "AUTH_RECONNECT_REQUIRED",
        nodeId: "n1",
        nodeName: "Send email",
      })
      expect(out.category).toBe("auth")
      expect(out.title).toBe("Reconnect Gmail")
      expect(out.description).toContain("Gmail")
      expect(out.hint).toContain("Reconnect Gmail")
      expect(out.action).toBe("reconnect")
      expect(out.severity).toBe("error")
      expect(out.nodeId).toBe("n1")
      expect(out.nodeName).toBe("Send email")
    })

    it("falls back to generic provider name when unknown", () => {
      const out = humanizeActionError({
        category: "auth",
        provider: "obscure_provider",
      })
      expect(out.title).toBe("Reconnect Obscure_provider")
    })

    it("infers auth category from 401 message when category absent", () => {
      const out = humanizeActionError({
        provider: "slack",
        message: "Request failed: 401 Unauthorized",
      })
      expect(out.category).toBe("auth")
      expect(out.action).toBe("reconnect")
    })

    it("infers auth category from invalid_grant code", () => {
      const out = humanizeActionError({
        provider: "google",
        error: { code: "invalid_grant" },
      })
      expect(out.category).toBe("auth")
    })
  })

  describe("category: config", () => {
    it("formats MISSING_VARIABLE with field path", () => {
      const out = humanizeActionError({
        category: "config",
        error: { code: "MISSING_VARIABLE", path: "config.body" },
        nodeName: "Slack post",
      })
      expect(out.category).toBe("config")
      expect(out.code).toBe("MISSING_VARIABLE")
      expect(out.path).toBe("config.body")
      expect(out.title).toBe("Missing variable")
      expect(out.description).toContain("Body")
      expect(out.action).toBe("open_node")
    })

    it("formats MISSING_REQUIRED_FIELD with field path", () => {
      const out = humanizeActionError({
        category: "config",
        error: { code: "MISSING_REQUIRED_FIELD", path: "to" },
      })
      expect(out.title).toBe("Required field missing")
      expect(out.description).toContain('"To"')
      expect(out.action).toBe("open_node")
    })

    it("formats INVALID_TIME_FORMAT", () => {
      const out = humanizeActionError({
        category: "config",
        error: { code: "INVALID_TIME_FORMAT", path: "startTime" },
      })
      expect(out.title).toBe("Invalid time format")
      expect(out.description).toContain("HH:MM")
      expect(out.action).toBe("open_node")
    })

    it("handles missing path gracefully", () => {
      const out = humanizeActionError({
        category: "config",
        error: { code: "MISSING_VARIABLE" },
      })
      expect(out.title).toBe("Missing variable")
      expect(out.action).toBe("open_node")
    })

    it("strips array indices from path", () => {
      const out = humanizeActionError({
        category: "config",
        error: { code: "MISSING_REQUIRED_FIELD", path: "attendees[0].email" },
      })
      expect(out.description).toContain('"Email"')
    })
  })

  describe("category: idempotency", () => {
    it("PAYLOAD_MISMATCH gets warning severity and no action", () => {
      const out = humanizeActionError({
        category: "idempotency",
        error: "PAYLOAD_MISMATCH",
      })
      expect(out.category).toBe("idempotency")
      expect(out.title).toContain("Duplicate")
      expect(out.severity).toBe("warning")
      expect(out.action).toBeNull()
    })
  })

  describe("category: billing", () => {
    it("explicit billing category gets upgrade CTA", () => {
      const out = humanizeActionError({
        category: "billing",
        error: "INSUFFICIENT_BALANCE",
      })
      expect(out.title).toBe("Insufficient task balance")
      expect(out.action).toBe("upgrade_plan")
    })

    it("infers billing from 402 + payment in message", () => {
      const out = humanizeActionError({
        message: "402 Payment Required: insufficient task balance",
      })
      expect(out.category).toBe("billing")
      expect(out.action).toBe("upgrade_plan")
    })
  })

  describe("category: provider", () => {
    it("rate limit signal infers provider category", () => {
      const out = humanizeActionError({
        provider: "slack",
        message: "ratelimited: 429 Too Many Requests",
      })
      expect(out.category).toBe("provider")
      expect(out.title).toContain("Slack")
      expect(out.action).toBeNull()
    })

    it("5xx signal infers provider category", () => {
      const out = humanizeActionError({
        provider: "stripe",
        message: "503 Service Unavailable",
      })
      expect(out.category).toBe("provider")
      expect(out.title).toContain("Stripe")
    })

    it("explicit provider category surfaces the original message", () => {
      const out = humanizeActionError({
        category: "provider",
        provider: "discord",
        message: "Invalid channel ID: 123",
      })
      expect(out.category).toBe("provider")
      expect(out.description).toContain("Invalid channel ID")
    })
  })

  describe("category: validation", () => {
    it("validation surfaces handler message and open_node action", () => {
      const out = humanizeActionError({
        category: "validation",
        message: "Amount must be greater than zero",
      })
      expect(out.title).toBe("Invalid input")
      expect(out.description).toContain("Amount must be greater than zero")
      expect(out.action).toBe("open_node")
    })
  })

  describe("category: internal (fallback)", () => {
    it("unknown category falls through to internal", () => {
      const out = humanizeActionError({
        category: "weird_unknown_value",
        message: "Something exploded",
      })
      expect(out.category).toBe("internal")
      expect(out.title).toBe("Unexpected error")
      expect(out.description).toContain("Something exploded")
      expect(out.action).toBeNull()
    })

    it("no input at all returns internal with generic message", () => {
      const out = humanizeActionError({})
      expect(out.category).toBe("internal")
      expect(out.title).toBe("Unexpected error")
      expect(out.action).toBeNull()
    })

    it("preserves nodeId/nodeName in fallback", () => {
      const out = humanizeActionError({
        nodeId: "n42",
        nodeName: "My step",
      })
      expect(out.nodeId).toBe("n42")
      expect(out.nodeName).toBe("My step")
    })
  })

  describe("input flexibility", () => {
    it("accepts error as a string", () => {
      const out = humanizeActionError({
        category: "provider",
        error: "Some opaque provider error string",
      })
      expect(out.code).toBe("Some opaque provider error string")
      expect(out.path).toBeNull()
    })

    it("accepts error as { code, path }", () => {
      const out = humanizeActionError({
        category: "config",
        error: { code: "MISSING_REQUIRED_FIELD", path: "email" },
      })
      expect(out.code).toBe("MISSING_REQUIRED_FIELD")
      expect(out.path).toBe("email")
    })

    it("explicit category overrides heuristic", () => {
      const out = humanizeActionError({
        category: "validation",
        message: "401 Unauthorized",
      })
      expect(out.category).toBe("validation")
    })

    it("rawErrorDetails participates in heuristic inference", () => {
      const out = humanizeActionError({
        rawErrorDetails: { details: { status: 401, body: "Unauthorized" } },
      })
      expect(out.category).toBe("auth")
    })
  })
})
