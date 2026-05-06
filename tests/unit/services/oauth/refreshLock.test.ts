/**
 * @jest-environment node
 *
 * Tests for the in-process single-flight refresh lock.
 */
import {
  __resetRefreshLockForTests,
  refreshLockKey,
  withRefreshLock,
} from "@/services/oauth/refreshLock";

beforeEach(() => {
  __resetRefreshLockForTests();
});

describe("refreshLockKey", () => {
  it("composes userId + provider + accountId", () => {
    expect(
      refreshLockKey({ userId: "u-1", provider: "gmail", accountId: "alice@x" }),
    ).toBe("u-1:gmail:alice@x");
  });

  it("uses 'default' when accountId is null", () => {
    expect(
      refreshLockKey({ userId: "u-1", provider: "slack", accountId: null }),
    ).toBe("u-1:slack:default");
  });

  it("different accountIds produce distinct keys", () => {
    const a = refreshLockKey({ userId: "u", provider: "gmail", accountId: "a" });
    const b = refreshLockKey({ userId: "u", provider: "gmail", accountId: "b" });
    expect(a).not.toBe(b);
  });
});

describe("withRefreshLock — single-flight semantics", () => {
  it("a single caller runs fn exactly once and gets its result", async () => {
    const fn = jest.fn().mockResolvedValue("token-1");
    const result = await withRefreshLock("k1", fn);
    expect(result).toBe("token-1");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("100 concurrent callers for the same key produce ONE fn invocation; all see the same result", async () => {
    let invocations = 0;
    const fn = jest.fn().mockImplementation(async () => {
      invocations += 1;
      // Yield a tick so the first invocation hasn't resolved yet when other
      // callers join the lock.
      await new Promise((r) => setImmediate(r));
      return `token-${invocations}`;
    });

    const callers = Array.from({ length: 100 }, () => withRefreshLock("shared-key", fn));
    const results = await Promise.all(callers);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(invocations).toBe(1);
    // Every caller sees the SAME resolved value (the in-flight promise).
    for (const r of results) {
      expect(r).toBe("token-1");
    }
  });

  it("different keys are independent (no cross-key collapsing)", async () => {
    const fnA = jest.fn().mockResolvedValue("A");
    const fnB = jest.fn().mockResolvedValue("B");
    const [a, b] = await Promise.all([
      withRefreshLock("key-A", fnA),
      withRefreshLock("key-B", fnB),
    ]);
    expect(a).toBe("A");
    expect(b).toBe("B");
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("releases the lock after fn resolves (subsequent calls re-run fn)", async () => {
    const fn = jest.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const r1 = await withRefreshLock("k", fn);
    const r2 = await withRefreshLock("k", fn);
    expect(r1).toBe("first");
    expect(r2).toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("releases the lock after fn rejects (subsequent calls re-run fn)", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");
    await expect(withRefreshLock("k", fn)).rejects.toThrow(/boom/);
    const r = await withRefreshLock("k", fn);
    expect(r).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejection propagates to all concurrent waiters with the same error", async () => {
    const fn = jest.fn().mockImplementation(async () => {
      await new Promise((r) => setImmediate(r));
      throw new Error("upstream-fail");
    });
    const callers = Array.from({ length: 5 }, () => withRefreshLock("k-fail", fn));
    const settled = await Promise.allSettled(callers);
    expect(fn).toHaveBeenCalledTimes(1);
    for (const s of settled) {
      expect(s.status).toBe("rejected");
      if (s.status === "rejected") {
        expect((s.reason as Error).message).toBe("upstream-fail");
      }
    }
  });
});
