/**
 * @jest-environment node
 *
 * Variable resolver — covers tests #1–#14 from
 * docs/rules/variable-resolver.md "Required tests" section. Test #15
 * (V1 parity) lives at tests/parity/v1-resolver-drift.test.ts — composition-
 * level coverage that proves the real resolver + engine + handler chain
 * doesn't let unresolved {{...}} reach a handler. This file covers the
 * resolver in isolation; the parity file covers the chain.
 */

import {
  resolveSoft,
  resolveStrict,
  MissingVariableError,
  type AIFieldRef,
  type UnresolvedReference,
} from "@/workflow-engine/variables/resolveValue";

describe("Test #1: strict mode raises MissingVariableError", () => {
  it("throws MissingVariableError for a missing top-level reference", () => {
    expect(() =>
      resolveStrict("{{node1.value}}", { variables: {} }),
    ).toThrow(MissingVariableError);
  });

  it("the thrown error carries path + reason", () => {
    expect.assertions(3);
    try {
      resolveStrict("{{node1.value}}", { variables: {} });
    } catch (e) {
      expect(e).toBeInstanceOf(MissingVariableError);
      expect((e as MissingVariableError).path).toBe("node1.value");
      expect((e as MissingVariableError).reason).toBe("missing_node");
    }
  });

  it("missing nested field reports missing_field", () => {
    expect.assertions(1);
    try {
      resolveStrict("{{node1.field}}", {
        variables: { node1: { other: 1 } },
      });
    } catch (e) {
      expect((e as MissingVariableError).reason).toBe("missing_field");
    }
  });
});

describe("Test #2: soft mode missing-reference behavior", () => {
  it("returns undefined for a missing single-reference template", () => {
    expect(resolveSoft("{{node1.value}}", { variables: {} })).toBeUndefined();
  });

  it("preserves the literal {{...}} for a missing reference inside a mixed string", () => {
    expect(resolveSoft("Hello {{user.name}}", { variables: {} })).toBe(
      "Hello {{user.name}}",
    );
  });

  it("preserves byte-exact original token (whitespace included)", () => {
    expect(resolveSoft("Hi {{ user.name }}!", { variables: {} })).toBe(
      "Hi {{ user.name }}!",
    );
  });
});

describe("Test #3: soft mode populates unresolvedCollector", () => {
  it("records standalone misses", () => {
    const collector: UnresolvedReference[] = [];
    resolveSoft("{{a.x}}", { variables: {} }, { unresolvedCollector: collector });
    expect(collector).toEqual([{ path: "a.x", reason: "missing_node" }]);
  });

  it("records mixed-string misses", () => {
    const collector: UnresolvedReference[] = [];
    resolveSoft(
      "Hi {{b.y}}",
      { variables: {} },
      { unresolvedCollector: collector },
    );
    expect(collector).toEqual([{ path: "b.y", reason: "missing_node" }]);
  });

  it("records every miss across multiple references in one string", () => {
    const collector: UnresolvedReference[] = [];
    resolveSoft(
      "Hi {{u.name}}, your id is {{u.id}}",
      { variables: {} },
      { unresolvedCollector: collector },
    );
    expect(collector).toEqual([
      { path: "u.name", reason: "missing_node" },
      { path: "u.id", reason: "missing_node" },
    ]);
  });

  it("records misses while walking a nested structure", () => {
    const collector: UnresolvedReference[] = [];
    resolveSoft(
      { msg: "Hi {{u.name}}", id: "{{u.id}}" },
      { variables: {} },
      { unresolvedCollector: collector },
    );
    expect(collector).toEqual([
      { path: "u.name", reason: "missing_node" },
      { path: "u.id", reason: "missing_node" },
    ]);
  });

  it("does not require a collector to function", () => {
    expect(resolveSoft("{{x}}", { variables: {} })).toBeUndefined();
  });
});

describe("Test #4: AI_FIELD detection (no AI client call)", () => {
  it("strict mode returns an AIFieldRef sentinel for {{AI_FIELD:fieldName}}", () => {
    const result = resolveStrict("{{AI_FIELD:summary}}", { variables: {} });
    expect(result).toEqual({ __aiField: true, fieldName: "summary" });
  });

  it("soft mode returns a placeholder string for {{AI_FIELD:fieldName}}", () => {
    expect(resolveSoft("{{AI_FIELD:summary}}", { variables: {} })).toBe(
      "[AI_FIELD:summary]",
    );
  });

  it("does not throw when variables is empty (AI_FIELD does not look up paths)", () => {
    expect(() =>
      resolveStrict("{{AI_FIELD:summary}}", { variables: {} }),
    ).not.toThrow();
  });
});

describe("Test #5: nested dot-path resolution", () => {
  it("resolves a.b.c", () => {
    expect(
      resolveStrict("{{node1.outer.inner}}", {
        variables: { node1: { outer: { inner: 42 } } },
      }),
    ).toBe(42);
  });

  it("resolves four-level deep path", () => {
    expect(
      resolveStrict("{{a.b.c.d}}", {
        variables: { a: { b: { c: { d: "deep" } } } },
      }),
    ).toBe("deep");
  });
});

describe("Test #6: array bracket resolution", () => {
  it("resolves items[0]", () => {
    expect(
      resolveStrict("{{node1.items[0]}}", {
        variables: { node1: { items: ["a", "b"] } },
      }),
    ).toBe("a");
  });

  it("resolves items[0].name (chained property after index)", () => {
    expect(
      resolveStrict("{{node1.items[0].name}}", {
        variables: { node1: { items: [{ name: "first" }, { name: "second" }] } },
      }),
    ).toBe("first");
  });

  it("resolves nested arrays items[0][1]", () => {
    expect(
      resolveStrict("{{node1.matrix[1][0]}}", {
        variables: { node1: { matrix: [[1, 2], [3, 4]] } },
      }),
    ).toBe(3);
  });
});

describe("Test #7: out-of-bounds array index → missing reference", () => {
  it("strict throws MissingVariableError with reason array_out_of_bounds", () => {
    expect.assertions(2);
    try {
      resolveStrict("{{node1.items[5]}}", {
        variables: { node1: { items: ["a"] } },
      });
    } catch (e) {
      expect(e).toBeInstanceOf(MissingVariableError);
      expect((e as MissingVariableError).reason).toBe("array_out_of_bounds");
    }
  });

  it("soft single-ref out-of-bounds returns undefined", () => {
    expect(
      resolveSoft("{{node1.items[5]}}", {
        variables: { node1: { items: ["a"] } },
      }),
    ).toBeUndefined();
  });

  it("soft mixed-string out-of-bounds preserves literal", () => {
    expect(
      resolveSoft("Got {{node1.items[5]}}", {
        variables: { node1: { items: ["a"] } },
      }),
    ).toBe("Got {{node1.items[5]}}");
  });
});

describe("Test #8: mixed-template interpolation", () => {
  it("strict resolves all references in a mixed string", () => {
    expect(
      resolveStrict("Hi {{u.name}}, order {{o.id}}", {
        variables: { u: { name: "Marcus" }, o: { id: 99 } },
      }),
    ).toBe("Hi Marcus, order 99");
  });

  it("strict throws on the first missing reference in a mixed string", () => {
    expect(() =>
      resolveStrict("Hi {{u.name}}, order {{o.id}}", {
        variables: { u: { name: "Marcus" } },
      }),
    ).toThrow(MissingVariableError);
  });

  it("soft replaces missing references with the original literal token, keeping resolved ones", () => {
    expect(
      resolveSoft("Hi {{u.name}}, order {{o.id}}", {
        variables: { u: { name: "Marcus" } },
      }),
    ).toBe("Hi Marcus, order {{o.id}}");
  });
});

describe("Test #9: single-reference template preserves underlying type", () => {
  it("number stays a number", () => {
    expect(
      resolveStrict("{{node1.count}}", {
        variables: { node1: { count: 7 } },
      }),
    ).toBe(7);
  });

  it("boolean stays a boolean", () => {
    expect(
      resolveStrict("{{node1.enabled}}", {
        variables: { node1: { enabled: true } },
      }),
    ).toBe(true);
  });

  it("object stays an object", () => {
    expect(
      resolveStrict("{{node1.payload}}", {
        variables: { node1: { payload: { a: 1, b: [2, 3] } } },
      }),
    ).toEqual({ a: 1, b: [2, 3] });
  });

  it("array stays an array", () => {
    expect(
      resolveStrict("{{node1.items}}", {
        variables: { node1: { items: ["a", "b"] } },
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("Test #10: Q5 invariant — 0, false, '' are explicit values", () => {
  it("0 resolves as the number 0, not missing", () => {
    expect(
      resolveStrict("{{node1.retries}}", {
        variables: { node1: { retries: 0 } },
      }),
    ).toBe(0);
  });

  it("false resolves as the boolean false, not missing", () => {
    expect(
      resolveStrict("{{node1.flag}}", {
        variables: { node1: { flag: false } },
      }),
    ).toBe(false);
  });

  it("empty string resolves as the empty string, not missing", () => {
    expect(
      resolveStrict("{{node1.label}}", {
        variables: { node1: { label: "" } },
      }),
    ).toBe("");
  });

  it("null resolves as null, not missing", () => {
    expect(
      resolveStrict("{{node1.value}}", {
        variables: { node1: { value: null } },
      }),
    ).toBeNull();
  });

  it("explicit zero in mixed string coerces to '0' (not 'undefined' or missing)", () => {
    expect(
      resolveStrict("retries={{node1.retries}}", {
        variables: { node1: { retries: 0 } },
      }),
    ).toBe("retries=0");
  });
});

describe("Test #11: whitespace inside {{ ... }} is trimmed", () => {
  it("leading and trailing whitespace inside braces is trimmed", () => {
    expect(
      resolveStrict("{{  node1.field  }}", {
        variables: { node1: { field: "ok" } },
      }),
    ).toBe("ok");
  });

  it("AI_FIELD with surrounding whitespace still classifies as AI_FIELD", () => {
    expect(resolveSoft("{{ AI_FIELD:summary }}", { variables: {} })).toBe(
      "[AI_FIELD:summary]",
    );
  });

  it("rejects \\{{...}} escape (reserved but unimplemented)", () => {
    expect(() =>
      resolveStrict("\\{{node1.field}}", { variables: {} }),
    ).toThrow(/Escape syntax/);
  });
});

describe("Test #12: resolver does not mutate input", () => {
  it("does not mutate the value argument when walking nested structures", () => {
    const value = {
      msg: "Hi {{u.name}}",
      list: ["{{u.name}}", "static"],
      nested: { greeting: "{{u.name}}", count: 0 },
    };
    const before = JSON.parse(JSON.stringify(value));
    resolveStrict(value, { variables: { u: { name: "Marcus" } } });
    expect(value).toEqual(before);
  });

  it("does not mutate the context.variables object", () => {
    const ctx = {
      variables: { u: { name: "Marcus", nested: { x: 1 } } },
    };
    const before = JSON.parse(JSON.stringify(ctx));
    resolveStrict(
      { msg: "Hi {{u.name}}, x={{u.nested.x}}" },
      ctx,
    );
    expect(ctx).toEqual(before);
  });

  it("returns a new object rather than the input", () => {
    const value = { msg: "Hi {{u.name}}" };
    const result = resolveStrict(value, {
      variables: { u: { name: "Marcus" } },
    });
    expect(result).not.toBe(value);
  });

  it("returns a new array rather than the input array", () => {
    const value = ["Hi {{u.name}}"];
    const result = resolveStrict(value, {
      variables: { u: { name: "Marcus" } },
    });
    expect(result).not.toBe(value);
  });
});

describe("Test #13: deterministic — identical input produces identical output", () => {
  it("two calls with the same input return deeply-equal output", () => {
    const input = {
      msg: "Hi {{u.name}}",
      list: ["{{u.name}}", "{{u.id}}"],
      ai: "{{AI_FIELD:summary}}",
      flag: "{{u.enabled}}",
    };
    const context = {
      variables: { u: { name: "Marcus", id: 7, enabled: false } },
    };
    const a = resolveStrict(input, context);
    const b = resolveStrict(input, context);
    expect(a).toEqual(b);
  });

  it("soft-mode collector population is deterministic", () => {
    const input = "Hi {{a.x}}, see {{b.y}}";
    const c1: UnresolvedReference[] = [];
    const c2: UnresolvedReference[] = [];
    resolveSoft(input, { variables: {} }, { unresolvedCollector: c1 });
    resolveSoft(input, { variables: {} }, { unresolvedCollector: c2 });
    expect(c1).toEqual(c2);
  });
});

describe("Test #14: AI_FIELD with nested inner reference", () => {
  it("strict resolves inner reference and emits sentinel with resolvedParam", () => {
    const result = resolveStrict("{{AI_FIELD:summaryOf:{{node1.text}}}}", {
      variables: { node1: { text: "Hello world" } },
    }) as AIFieldRef;
    expect(result.__aiField).toBe(true);
    expect(result.fieldName).toBe("summaryOf");
    expect(result.resolvedParam).toBe("Hello world");
  });

  it("preserves typed inner values (object) in resolvedParam — no AI client invocation", () => {
    const result = resolveStrict("{{AI_FIELD:enrich:{{node1.payload}}}}", {
      variables: { node1: { payload: { id: 7, name: "x" } } },
    }) as AIFieldRef;
    expect(result.resolvedParam).toEqual({ id: 7, name: "x" });
  });

  it("strict propagates a missing inner reference as MissingVariableError", () => {
    expect(() =>
      resolveStrict("{{AI_FIELD:summaryOf:{{node1.text}}}}", {
        variables: {},
      }),
    ).toThrow(MissingVariableError);
  });

  it("AIFieldRef without inner reference omits resolvedParam", () => {
    const result = resolveStrict("{{AI_FIELD:summary}}", {
      variables: {},
    }) as AIFieldRef;
    expect(result.__aiField).toBe(true);
    expect(result.fieldName).toBe("summary");
    expect("resolvedParam" in result).toBe(false);
  });
});

describe("walking nested values — not numbered but exercises the contract", () => {
  it("walks plain objects, arrays, and primitives in one pass", () => {
    const result = resolveStrict(
      {
        text: "Hi {{u.name}}",
        count: 5,
        items: ["{{u.id}}", "static"],
        flags: { active: true, label: "{{u.label}}" },
      },
      {
        variables: { u: { name: "Marcus", id: 1, label: "ok" } },
      },
    );
    expect(result).toEqual({
      text: "Hi Marcus",
      count: 5,
      items: [1, "static"],
      flags: { active: true, label: "ok" },
    });
  });

  it("preserves primitive non-string values unchanged at top level", () => {
    const ctx = { variables: {} };
    expect(resolveStrict(0, ctx)).toBe(0);
    expect(resolveStrict(false, ctx)).toBe(false);
    expect(resolveStrict(null, ctx)).toBeNull();
    expect(resolveStrict(undefined, ctx)).toBeUndefined();
  });

  it("returns plain strings (no templates) unchanged", () => {
    expect(resolveStrict("hello", { variables: {} })).toBe("hello");
  });
});
