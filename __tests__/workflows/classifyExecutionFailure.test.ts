/**
 * Unit tests for lib/workflows/errors/classifyExecutionFailure.ts.
 *
 * The classifier is the bridge between raw execution_steps rows and the
 * humanized snapshot persisted on workflow_execution_sessions. It must:
 *  - Pick the FIRST failed step (lowest step_number)
 *  - Derive provider from node_type (gmail_action_send → gmail) when
 *    error_details doesn't carry one
 *  - Pull through structured error_details when present
 *  - Fall back to humanizing the engine fallback message when no failed
 *    steps were recorded
 *  - Never throw — DB lookup failures degrade to an `internal` snapshot
 */

jest.mock("@/lib/utils/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}))

import { classifyExecutionFailure } from "@/lib/workflows/errors/classifyExecutionFailure"

/**
 * Build a chainable Supabase mock whose final `order(...)` resolves to the
 * provided `{ data, error }` payload. The classifier calls
 * `.from('execution_steps').select(...).eq(...).eq(...).order(...)` and
 * then awaits — so awaiting the returned Promise yields the final payload.
 */
function mockExecutionStepsQuery(finalResult: { data: any; error?: any }) {
  const promiseLike: any = Promise.resolve(finalResult)
  const proxy: any = new Proxy({} as any, {
    get(_target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        return (promiseLike as any)[prop].bind(promiseLike)
      }
      // Every other method (eq, select, order) returns the same chainable
      return jest.fn().mockReturnValue(proxy)
    },
  })
  return {
    from: jest.fn().mockReturnValue(proxy),
  }
}

describe("classifyExecutionFailure", () => {
  describe("no failed steps", () => {
    it("falls back to humanizing the fallback message when execution_steps returns []", async () => {
      const supabase = mockExecutionStepsQuery({ data: [], error: null })
      const result = await classifyExecutionFailure(
        supabase,
        "exec_1",
        "Engine crashed: Cannot read property 'foo' of undefined"
      )
      expect(result.firstFailedNodeId).toBeNull()
      expect(result.failedNodeCount).toBe(0)
      // No category signals → defaults to internal
      expect(result.category).toBe("internal")
      expect(result.title).toBe("Unexpected error")
    })

    it("infers category from fallback message when DB returns no rows", async () => {
      const supabase = mockExecutionStepsQuery({ data: [], error: null })
      const result = await classifyExecutionFailure(
        supabase,
        "exec_1",
        "Request failed: 401 Unauthorized"
      )
      expect(result.category).toBe("auth")
      expect(result.failedNodeCount).toBe(0)
    })

    it("returns internal classification when fallback message is null", async () => {
      const supabase = mockExecutionStepsQuery({ data: [], error: null })
      const result = await classifyExecutionFailure(supabase, "exec_1", null)
      expect(result.category).toBe("internal")
      expect(result.failedNodeCount).toBe(0)
    })
  })

  describe("with failed steps", () => {
    it("picks the first failed step and uses its node info", async () => {
      const supabase = mockExecutionStepsQuery({
        data: [
          {
            node_id: "node_a",
            node_type: "gmail_action_send",
            node_name: "Send confirmation",
            error_message: "Token expired",
            error_details: { status: 401 },
            step_number: 1,
          },
          {
            node_id: "node_b",
            node_type: "slack_action_post_message",
            node_name: "Notify ops",
            error_message: "channel not found",
            error_details: null,
            step_number: 2,
          },
        ],
        error: null,
      })
      const result = await classifyExecutionFailure(supabase, "exec_1", null)
      expect(result.firstFailedNodeId).toBe("node_a")
      expect(result.nodeName).toBe("Send confirmation")
      expect(result.failedNodeCount).toBe(2)
    })

    it("derives provider from node_type prefix when error_details lacks one", async () => {
      const supabase = mockExecutionStepsQuery({
        data: [
          {
            node_id: "node_a",
            node_type: "gmail_action_send",
            node_name: "Send",
            error_message: "401 Unauthorized",
            error_details: null,
            step_number: 1,
          },
        ],
        error: null,
      })
      const result = await classifyExecutionFailure(supabase, "exec_1", null)
      expect(result.provider).toBe("gmail")
    })

    it("prefers explicit provider in error_details over node_type prefix", async () => {
      const supabase = mockExecutionStepsQuery({
        data: [
          {
            node_id: "node_a",
            node_type: "core_logic_branch",
            node_name: "Branch",
            error_message: "boom",
            error_details: { provider: "stripe" },
            step_number: 1,
          },
        ],
        error: null,
      })
      const result = await classifyExecutionFailure(supabase, "exec_1", null)
      expect(result.provider).toBe("stripe")
    })

    it("ignores non-provider node prefixes (core/logic/ai)", async () => {
      const supabase = mockExecutionStepsQuery({
        data: [
          {
            node_id: "node_a",
            node_type: "core_logic_branch",
            node_name: "Branch",
            error_message: "boom",
            error_details: null,
            step_number: 1,
          },
        ],
        error: null,
      })
      const result = await classifyExecutionFailure(supabase, "exec_1", null)
      expect(result.provider).toBeNull()
    })

    it("threads through structured error_details.error → humanizer", async () => {
      const supabase = mockExecutionStepsQuery({
        data: [
          {
            node_id: "node_a",
            node_type: "gmail_action_send",
            node_name: "Send",
            error_message: "MISSING_VARIABLE",
            error_details: {
              category: "config",
              error: { code: "MISSING_VARIABLE", path: "config.body" },
            },
            step_number: 1,
          },
        ],
        error: null,
      })
      const result = await classifyExecutionFailure(supabase, "exec_1", null)
      expect(result.category).toBe("config")
      expect(result.code).toBe("MISSING_VARIABLE")
      expect(result.path).toBe("config.body")
      expect(result.action).toBe("open_node")
    })

    it("threads through error_details.classifiedError shape", async () => {
      // Some handlers stash the structured error under classifiedError instead
      // of error. Both paths should work.
      const supabase = mockExecutionStepsQuery({
        data: [
          {
            node_id: "node_a",
            node_type: "stripe_action_create_payment_intent",
            node_name: "Charge",
            error_message: "PAYLOAD_MISMATCH",
            error_details: {
              classifiedError: { category: "idempotency", code: "PAYLOAD_MISMATCH" },
            },
            step_number: 1,
          },
        ],
        error: null,
      })
      const result = await classifyExecutionFailure(supabase, "exec_1", null)
      expect(result.category).toBe("idempotency")
      expect(result.severity).toBe("warning")
    })

    it("falls back to raw error_message when error_details has no structure", async () => {
      const supabase = mockExecutionStepsQuery({
        data: [
          {
            node_id: "node_a",
            node_type: "slack_action_post_message",
            node_name: "Post",
            error_message: "ratelimited: 429 Too Many Requests",
            error_details: null,
            step_number: 1,
          },
        ],
        error: null,
      })
      const result = await classifyExecutionFailure(supabase, "exec_1", null)
      // Heuristic infers "provider" category from rate-limit signals
      expect(result.category).toBe("provider")
      expect(result.provider).toBe("slack")
    })
  })

  describe("DB failures degrade gracefully", () => {
    it("returns an internal classification when execution_steps query errors", async () => {
      const supabase = mockExecutionStepsQuery({
        data: null,
        error: { message: "RLS denied" },
      })
      const result = await classifyExecutionFailure(supabase, "exec_1", "boom")
      expect(result.category).toBe("internal")
      expect(result.failedNodeCount).toBe(0)
      expect(result.firstFailedNodeId).toBeNull()
    })

    it("never throws when supabase.from itself throws", async () => {
      const supabase = {
        from: jest.fn().mockImplementation(() => {
          throw new Error("supabase client offline")
        }),
      }
      const result = await classifyExecutionFailure(supabase, "exec_1", "boom")
      expect(result.category).toBe("internal")
      expect(result.failedNodeCount).toBe(0)
    })
  })
})
