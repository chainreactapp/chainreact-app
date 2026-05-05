/**
 * Unit tests for lib/notifications/workflowFailurePayload.ts.
 *
 * The payload builder is pure — it deterministically converts a humanized
 * classification + workflow + execution context into the channel-agnostic
 * shape every notification renderer reads from. Bugs here ripple to all
 * channels at once, so every CTA branch is covered.
 */

import { buildWorkflowFailurePayload } from "@/lib/notifications/workflowFailurePayload"
import type { PersistedErrorClassification } from "@/lib/workflows/errors/classifyExecutionFailure"

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL
})

function classification(
  partial: Partial<PersistedErrorClassification>
): PersistedErrorClassification {
  return {
    category: "internal",
    code: null,
    provider: null,
    path: null,
    title: "Unexpected error",
    description: "Something went wrong.",
    hint: null,
    action: null,
    severity: "error",
    nodeId: null,
    nodeName: null,
    firstFailedNodeId: null,
    failedNodeCount: 1,
    ...partial,
  }
}

describe("buildWorkflowFailurePayload — basics", () => {
  it("builds subject as `${title}: ${workflowName}`", () => {
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "Daily ingest",
      executionId: "exec_1",
      classification: classification({ title: "Reconnect Gmail" }),
      rawErrorMessage: "401 Unauthorized",
    })
    expect(payload.subject).toBe("Reconnect Gmail: Daily ingest")
  })

  it("falls back to 'Workflow failed' when classification is null", () => {
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: null,
      classification: null,
      rawErrorMessage: "boom",
    })
    expect(payload.title).toBe("Workflow failed")
    expect(payload.description).toBe("boom")
  })

  it("falls back to a generic description when both classification and raw are null", () => {
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: null,
      classification: null,
      rawErrorMessage: null,
    })
    expect(payload.description).toMatch(/did not complete/)
  })

  it("preserves classification severity", () => {
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: null,
      classification: classification({ severity: "warning" }),
      rawErrorMessage: null,
    })
    expect(payload.severity).toBe("warning")
  })

  it("defaults severity to 'error' when classification omits it", () => {
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: null,
      classification: null,
      rawErrorMessage: "boom",
    })
    expect(payload.severity).toBe("error")
  })

  it("carries failedStepName from classification.nodeName", () => {
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: null,
      classification: classification({ nodeName: "Send confirmation email" }),
      rawErrorMessage: null,
    })
    expect(payload.failedStepName).toBe("Send confirmation email")
  })

  it("preserves raw error in technicalDetails", () => {
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: null,
      classification: classification({}),
      rawErrorMessage: "500 Internal Server Error",
    })
    expect(payload.technicalDetails).toBe("500 Internal Server Error")
  })
})

describe("buildWorkflowFailurePayload — CTA routing", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test"
  })

  describe("action = 'reconnect'", () => {
    it("routes to /integrations with provider name in label", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: "exec_1",
        classification: classification({
          action: "reconnect",
          provider: "gmail",
        }),
        rawErrorMessage: null,
      })
      expect(payload.cta).toEqual({
        label: "Reconnect Gmail",
        url: "https://app.test/integrations",
      })
    })

    it("falls back to generic label when provider is missing", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: null,
        classification: classification({ action: "reconnect", provider: null }),
        rawErrorMessage: null,
      })
      expect(payload.cta?.label).toBe("Reconnect integration")
    })
  })

  describe("action = 'open_node'", () => {
    it("routes to builder with focusNode + historyExecution query params", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: "exec_1",
        classification: classification({
          action: "open_node",
          nodeId: "node_42",
        }),
        rawErrorMessage: null,
      })
      expect(payload.cta?.label).toBe("Open failing node")
      expect(payload.cta?.url).toBe(
        "https://app.test/workflows/builder/wf_1?focusNode=node_42&historyExecution=exec_1"
      )
    })

    it("omits focusNode param when nodeId missing", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: "exec_1",
        classification: classification({
          action: "open_node",
          nodeId: null,
        }),
        rawErrorMessage: null,
      })
      expect(payload.cta?.url).toBe(
        "https://app.test/workflows/builder/wf_1?historyExecution=exec_1"
      )
    })

    it("emits a bare builder URL when neither nodeId nor executionId set", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: null,
        classification: classification({
          action: "open_node",
          nodeId: null,
        }),
        rawErrorMessage: null,
      })
      expect(payload.cta?.url).toBe("https://app.test/workflows/builder/wf_1")
    })
  })

  describe("action = 'upgrade_plan'", () => {
    it("routes to /subscription", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: "exec_1",
        classification: classification({ action: "upgrade_plan" }),
        rawErrorMessage: null,
      })
      expect(payload.cta).toEqual({
        label: "Manage billing",
        url: "https://app.test/subscription",
      })
    })
  })

  describe("action = null (no specific CTA)", () => {
    it("falls back to History deep-link when executionId present", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: "exec_1",
        classification: classification({ action: null }),
        rawErrorMessage: null,
      })
      expect(payload.cta).toEqual({
        label: "View execution",
        url: "https://app.test/workflows/builder/wf_1?historyExecution=exec_1",
      })
    })

    it("uses a bare builder URL when no executionId", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: null,
        classification: classification({ action: null }),
        rawErrorMessage: null,
      })
      expect(payload.cta?.url).toBe("https://app.test/workflows/builder/wf_1")
    })

    it("falls back to History deep-link when classification is null entirely", () => {
      const payload = buildWorkflowFailurePayload({
        workflowId: "wf_1",
        workflowName: "X",
        executionId: "exec_1",
        classification: null,
        rawErrorMessage: null,
      })
      expect(payload.cta?.url).toBe(
        "https://app.test/workflows/builder/wf_1?historyExecution=exec_1"
      )
    })
  })
})

describe("buildWorkflowFailurePayload — base URL", () => {
  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com"
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: "exec_1",
      classification: classification({ action: "reconnect", provider: "slack" }),
      rawErrorMessage: null,
    })
    expect(payload.cta?.url).toBe("https://staging.example.com/integrations")
  })

  it("strips trailing slash from base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com/"
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: null,
      classification: classification({ action: "upgrade_plan" }),
      rawErrorMessage: null,
    })
    expect(payload.cta?.url).toBe("https://staging.example.com/subscription")
  })

  it("falls back to chainreact.app when env not set", () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const payload = buildWorkflowFailurePayload({
      workflowId: "wf_1",
      workflowName: "X",
      executionId: null,
      classification: classification({ action: "reconnect", provider: "github" }),
      rawErrorMessage: null,
    })
    expect(payload.cta?.url).toBe("https://chainreact.app/integrations")
  })
})
