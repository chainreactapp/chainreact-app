import { cn } from "@/lib/utils";

describe("skeleton smoke", () => {
  it("merges class names through cn()", () => {
    expect(cn("a", "b")).toBe("a b");
    expect(cn("p-4", "p-2")).toBe("p-2");
  });
});
