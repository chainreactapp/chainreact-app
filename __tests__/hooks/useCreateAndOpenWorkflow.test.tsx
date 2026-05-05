/**
 * @jest-environment jsdom
 *
 * Contract: useCreateAndOpenWorkflow
 * Source: hooks/useCreateAndOpenWorkflow.ts
 *
 * When workflow creation fails, the hook MUST surface a destructive toast so
 * the user gets visible feedback. Before this fix, the hook only logged to
 * console and re-threw — clicks looked like "nothing happened".
 *
 * The toast variant is destructive and the description distinguishes auth
 * timeouts (the original failure mode) from generic create failures.
 */

const toastMock = jest.fn()
const routerPushMock = jest.fn()
const createWorkflowMock = jest.fn()
const setWorkspaceContextMock = jest.fn()

jest.mock("@/lib/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock("@/hooks/use-toast", () => ({
  toast: (...args: any[]) => toastMock(...args),
}))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

jest.mock("@/stores/workflowStore", () => ({
  useWorkflowStore: Object.assign(
    () => ({ setWorkspaceContext: setWorkspaceContextMock }),
    {
      getState: () => ({ createWorkflow: createWorkflowMock }),
    }
  ),
}))

jest.mock("@/hooks/useWorkspaceContext", () => ({
  useWorkspaceContext: () => ({
    workspaceContext: { type: "personal", id: null },
  }),
}))

jest.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ profile: { id: "u1" } }),
}))

import { renderHook, act } from "@testing-library/react"
import { useCreateAndOpenWorkflow } from "@/hooks/useCreateAndOpenWorkflow"

beforeEach(() => {
  toastMock.mockReset()
  routerPushMock.mockReset()
  createWorkflowMock.mockReset()
  setWorkspaceContextMock.mockReset()
})

describe("useCreateAndOpenWorkflow — failure surfaces a toast", () => {
  it("shows the auth-flavored toast when createWorkflow throws a session timeout", async () => {
    createWorkflowMock.mockRejectedValue(
      new Error("Supabase getSession timed out after 8000ms")
    )

    const { result } = renderHook(() => useCreateAndOpenWorkflow())

    await act(async () => {
      await expect(result.current.createAndOpen()).rejects.toThrow(
        /timed out/i
      )
    })

    expect(toastMock).toHaveBeenCalledTimes(1)
    const toastArg = toastMock.mock.calls[0][0]
    expect(toastArg.variant).toBe("destructive")
    expect(toastArg.title).toBe("Couldn't create workflow")
    expect(String(toastArg.description)).toMatch(/session.*expired/i)
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(result.current.isCreating).toBe(false)
    expect(result.current.error).toMatch(/timed out/i)
  })

  it("shows the generic toast when createWorkflow throws a non-auth error", async () => {
    createWorkflowMock.mockRejectedValue(new Error("Failed to create workflow: 500"))

    const { result } = renderHook(() => useCreateAndOpenWorkflow())

    await act(async () => {
      await expect(result.current.createAndOpen()).rejects.toThrow(/500/)
    })

    expect(toastMock).toHaveBeenCalledTimes(1)
    const toastArg = toastMock.mock.calls[0][0]
    expect(toastArg.variant).toBe("destructive")
    expect(String(toastArg.description)).toMatch(/refresh and try again/i)
    expect(String(toastArg.description)).not.toMatch(/session.*expired/i)
    expect(result.current.isCreating).toBe(false)
  })

  it("does not toast on success and navigates to the builder", async () => {
    createWorkflowMock.mockResolvedValue({ id: "wf-123" })

    const { result } = renderHook(() => useCreateAndOpenWorkflow())

    await act(async () => {
      const ret = await result.current.createAndOpen()
      expect(ret).toEqual({ flowId: "wf-123" })
    })

    expect(toastMock).not.toHaveBeenCalled()
    expect(routerPushMock).toHaveBeenCalledWith(
      "/workflows/builder/wf-123?openPanel=true"
    )
    expect(result.current.isCreating).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
