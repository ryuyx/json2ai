import { describe, expect, it } from "vitest";
import json2ai, { json2ai as named } from "../src/index.js";

describe("json2ai", () => {
  it("exports default and named", () => {
    expect(json2ai).toBe(named);
  });

  it("formats a flat object compactly", () => {
    expect(json2ai({ a: 1, b: "hello", c: true })).toBe(
      "a: 1\nb: hello\nc: true"
    );
  });

  it("nests objects with indentation", () => {
    expect(json2ai({ user: { id: 1, name: "ryuyx" } })).toBe(
      "user:\n id: 1\n name: ryuyx"
    );
  });

  it("formats arrays with index labels", () => {
    expect(json2ai({ tags: ["a", "b"] })).toBe(
      "tags:\n 0: a\n 1: b"
    );
  });

  it("handles primitives at the top level", () => {
    expect(json2ai("just text")).toBe("just text");
    expect(json2ai(null)).toBe("null");
    expect(json2ai(42)).toBe("42");
  });

  it("handles empty structures", () => {
    expect(json2ai({})).toBe("{}");
    expect(json2ai([])).toBe("[]");
  });

  it("wraps in a code block when requested", () => {
    expect(json2ai({ a: 1 }, { wrapInCodeBlock: true })).toBe(
      "```json\na: 1\n```"
    );
  });

  it("truncates large arrays", () => {
    const input = { list: [1, 2, 3, 4, 5] };
    const out = json2ai(input, { maxArrayItems: 3 });
    expect(out).toContain("... (2 more)[5]");
    expect(out).not.toContain("4:");
  });

  it("omits matching keys at any depth", () => {
    expect(
      json2ai({ id: 1, secret: "shh", nested: { secret: "x", keep: 2 } }, { omit: ["secret"] })
    ).toBe("id: 1\nnested:\n keep: 2");
  });

  it("escapes code fences inside strings", () => {
    const out = json2ai({ code: "fence ``` here" });
    expect(out).toContain("\\`\\`\\`");
  });
});