/**
 * @jest-environment node
 *
 * Tests for services/billing/executionBillingGate.ts.
 *
 * The gate is a thin wrapper over userBillingRepo.deductTasks; tests mock
 * the repo and verify the discriminated-outcome shape on both branches.
 */

const mockDeductTasks = jest.fn();
jest.mock("@/repositories/userBilling", () => ({
  deductTasks: (...args: unknown[]) => mockDeductTasks(...args),
}));

import { executionBillingGate } from "@/services/billing/executionBillingGate";

beforeEach(() => {
  mockDeductTasks.mockReset();
});

describe("executionBillingGate", () => {
  it("returns ok=true when the deduction succeeds", async () => {
    mockDeductTasks.mockResolvedValueOnce({ ok: true, used: 5, limit: 100 });
    const outcome = await executionBillingGate("user-1");
    expect(outcome).toEqual({ ok: true, used: 5, limit: 100 });
    expect(mockDeductTasks).toHaveBeenCalledWith("user-1", 1);
  });

  it("returns ok=false reason='limit_reached' when the deduction is refused", async () => {
    mockDeductTasks.mockResolvedValueOnce({ ok: false, used: 100, limit: 100 });
    const outcome = await executionBillingGate("user-1");
    expect(outcome).toEqual({
      ok: false,
      reason: "limit_reached",
      used: 100,
      limit: 100,
    });
  });

  it("Slice 1N charges exactly 1 task per run (no per-node pricing yet)", async () => {
    mockDeductTasks.mockResolvedValueOnce({ ok: true, used: 1, limit: 100 });
    await executionBillingGate("user-1");
    expect(mockDeductTasks).toHaveBeenCalledWith("user-1", 1);
  });

  it("propagates repository errors (RPC failure surfaces, not silently swallowed)", async () => {
    mockDeductTasks.mockRejectedValueOnce(new Error("RPC down"));
    await expect(executionBillingGate("user-1")).rejects.toThrow(/RPC down/);
  });
});
