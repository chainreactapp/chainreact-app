/**
 * @jest-environment node
 */

import { advanceCheckpoint } from "@/integrations/gmail/triggers/newEmail/historyState";

describe("advanceCheckpoint", () => {
  it("advances when the API historyId is greater than stored", () => {
    expect(
      advanceCheckpoint({ startHistoryId: "100", apiHistoryId: "200" }),
    ).toBe("200");
  });

  it("does not regress when the API historyId is smaller", () => {
    expect(
      advanceCheckpoint({ startHistoryId: "200", apiHistoryId: "100" }),
    ).toBe("200");
  });

  it("returns either when both are equal (idempotent)", () => {
    expect(
      advanceCheckpoint({ startHistoryId: "150", apiHistoryId: "150" }),
    ).toBe("150");
  });

  it("compares as BigInt — handles values larger than Number.MAX_SAFE_INTEGER", () => {
    const stored = "9007199254740993"; // > 2^53
    const fresh = "9007199254740994";
    expect(
      advanceCheckpoint({ startHistoryId: stored, apiHistoryId: fresh }),
    ).toBe(fresh);
  });

  it("falls back to startHistoryId when apiHistoryId is unparseable", () => {
    expect(
      advanceCheckpoint({ startHistoryId: "200", apiHistoryId: "not-a-number" }),
    ).toBe("200");
  });

  it("uses apiHistoryId when startHistoryId is unparseable", () => {
    expect(
      advanceCheckpoint({ startHistoryId: "junk", apiHistoryId: "300" }),
    ).toBe("300");
  });
});
