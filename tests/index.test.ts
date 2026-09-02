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

  it("formats primitive arrays as a md table", () => {
    expect(json2ai({ tags: ["a", "b"] })).toBe(
      "tags:\n a, b"
    );
  });

  it("formats arrays of homogeneous objects with scalar leaves as an md table", () => {
    expect(
      json2ai({
        users: [
          { id: 1, name: "a" },
          { id: 2, name: "b" },
        ],
      })
    ).toBe(
      "users:\n | index | id | name |\n | --- | --- | --- |\n | 0 | 1 | a |\n | 1 | 2 | b |"
    );
  });

  it("fuses nested sub-objects into cells as compact inline json", () => {
    expect(
      json2ai({
        logs: [
          { id: 1, ctx: { u: 3, r: { id: "x" } } },
          { id: 2, ctx: { u: 4, r: { id: "y" } } },
        ],
      })
    ).toBe(
      "logs:\n | index | id | ctx |\n | --- | --- | --- |\n | 0 | 1 | {u:3 r:{id:x}} |\n | 1 | 2 | {u:4 r:{id:y}} |"
    );
  });

  it("fuses nested object arrays into cells", () => {
    expect(
      json2ai({
        orders: [
          { id: 1, items: [{ sku: "a", qty: 2 }, { sku: "b", qty: 1 }] },
          { id: 2, items: [{ sku: "c", qty: 4 }] },
        ],
      })
    ).toBe(
      "orders:\n | index | id | items |\n | --- | --- | --- |\n | 0 | 1 | [{sku:a qty:2} {sku:b qty:1}] |\n | 1 | 2 | [{sku:c qty:4}] |"
    );
  });

  it("falls back to expansion for heterogeneous object arrays", () => {
    expect(
      json2ai({ arr: [{ id: 1, extra: "x" }, { id: 2 }] })
    ).toBe("arr:\n 0:\n  id: 1\n  extra: x\n 1:\n  id: 2");
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
      "```text\na: 1\n```"
    );
  });

  it("truncates large arrays after rendering the table", () => {
    const input = { list: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const out = json2ai(input, { maxArrayItems: 2 });
    expect(out).toBe(
      "list:\n | index | id |\n | --- | --- |\n | 0 | 1 |\n | 1 | 2 |\n ... (1 more)[3]"
    );
  });

  it("omits matching keys at any depth", () => {
    expect(
      json2ai({ id: 1, secret: "shh", nested: { secret: "x", keep: 2 } }, { omit: ["secret"] })
    ).toBe("id: 1\nnested:\n keep: 2");
  });

  it("omits fused container keys too", () => {
    expect(
      json2ai(
        {
          logs: [
            { id: 1, ctx: { u: 3, token: "x" } },
            { id: 2, ctx: { u: 4, token: "y" } },
          ],
        },
        { omit: ["token"] }
      )
    ).toBe(
      "logs:\n | index | id | ctx |\n | --- | --- | --- |\n | 0 | 1 | {u:3} |\n | 1 | 2 | {u:4} |"
    );
  });

  it("escapes pipes inside table cells", () => {
    const out = json2ai({ rows: [{ a: "x|y" }, { a: "z" }] });
    expect(out).toContain("x\\|y");
  });

  it("escapes code fences inside strings", () => {
    const out = json2ai({ code: "fence ``` here" });
    expect(out).toContain("\\`\\`\\`");
  });

  it("supports tsv format", () => {
    expect(
      json2ai(
        { users: [{ id: 1, name: "a" }, { id: 2, name: "b" }] },
        { format: "tsv" }
      )
    ).toBe("users:\n index\tid\tname\n 0\t1\ta\n 1\t2\tb");
  });

  it("renames a top-level key", () => {
    expect(json2ai({ name: "a" }, { rename: { name: "fullName" } })).toBe(
      "fullName: a"
    );
  });

  it("renames a nested key", () => {
    expect(
      json2ai(
        { user: { first: "a", last: "b" } },
        { rename: { "user.first": "given" } }
      )
    ).toBe("user:\n given: a\n last: b");
  });

  it("renames only the matching path, not same-named keys elsewhere", () => {
    expect(
      json2ai(
        { user: { first: "a" }, first: 1 },
        { rename: { "user.first": "given" } }
      )
    ).toBe("user:\n given: a\nfirst: 1");
  });

  it("treats object-form rename without a unit as equivalent to a string", () => {
    expect(json2ai({ name: "a" }, { rename: { name: { alias: "fullName" } } })).toBe(
      "fullName: a"
    );
  });

  it("renames column headers in a Markdown table", () => {
    expect(
      json2ai(
        { users: [{ id: 1, name: "a" }, { id: 2, name: "b" }] },
        { rename: { "users.name": "label" } }
      )
    ).toBe(
      "users:\n | index | id | label |\n | --- | --- | --- |\n | 0 | 1 | a |\n | 1 | 2 | b |"
    );
  });

  it("renames column headers in a TSV table", () => {
    expect(
      json2ai(
        { users: [{ id: 1, name: "a" }, { id: 2, name: "b" }] },
        { rename: { "users.name": "label" }, format: "tsv" }
      )
    ).toBe("users:\n index\tid\tlabel\n 0\t1\ta\n 1\t2\tb");
  });

  it("renames keys fused inside inline cells", () => {
    expect(
      json2ai(
        { logs: [{ id: 1, ctx: { u: 3 } }, { id: 2, ctx: { u: 4 } }] },
        { rename: { "logs.ctx.u": "user" } }
      )
    ).toBe(
      "logs:\n | index | id | ctx |\n | --- | --- | --- |\n | 0 | 1 | {user:3} |\n | 1 | 2 | {user:4} |"
    );
  });

  it("appends a unit to a top-level scalar", () => {
    expect(json2ai({ price: 100 }, { rename: { price: { unit: "USD" } } })).toBe(
      "price: 100 USD"
    );
  });

  it("appends a unit to a scalar in a table cell", () => {
    expect(
      json2ai(
        { products: [{ name: "a", price: 100 }] },
        { rename: { "products.price": { unit: "USD" } } }
      )
    ).toBe(
      "products:\n | index | name | price |\n | --- | --- | --- |\n | 0 | a | 100 USD |"
    );
  });

  it("combines alias and unit", () => {
    expect(json2ai({ qty: 3 }, { rename: { qty: { alias: "count", unit: "pcs" } } })).toBe(
      "count: 3 pcs"
    );
  });

  it("ignores a unit on a container value", () => {
    expect(
      json2ai(
        { user: { id: 1 } },
        { rename: { user: { unit: "USD" } } }
      )
    ).toBe("user:\n id: 1");
  });

  it("leaves output unchanged when rename is empty or absent", () => {
    const data = { user: { id: 1, name: "a" }, tags: ["x", "y"] };
    const expected = "user:\n id: 1\n name: a\ntags:\n x, y";
    expect(json2ai(data)).toBe(expected);
    expect(json2ai(data, { rename: {} })).toBe(expected);
  });

  it("gives omit precedence over rename", () => {
    expect(
      json2ai({ id: 1, secret: "shh" }, { rename: { secret: "token" }, omit: ["secret"] })
    ).toBe("id: 1");
  });

  it("converts a seconds timestamp to ISO 8601 UTC", () => {
    expect(
      json2ai({ created: 1756814400 }, { rename: { created: { type: "date" } } })
    ).toBe("created: 2025-09-02T12:00:00.000Z");
  });

  it("converts a milliseconds timestamp by magnitude auto-detection", () => {
    expect(
      json2ai({ created: 1756814400000 }, { rename: { created: { type: "date" } } })
    ).toBe("created: 2025-09-02T12:00:00.000Z");
  });

  it("converts a timestamp in a table cell", () => {
    expect(
      json2ai(
        { events: [{ id: 1, at: 1756814400 }, { id: 2, at: 1756814400000 }] },
        { rename: { "events.at": { type: "date" } } }
      )
    ).toBe(
      "events:\n | index | id | at |\n | --- | --- | --- |\n | 0 | 1 | 2025-09-02T12:00:00.000Z |\n | 1 | 2 | 2025-09-02T12:00:00.000Z |"
    );
  });

  it("passes non-numeric values through unchanged with type: date", () => {
    expect(
      json2ai({ created: "tomorrow" }, { rename: { created: { type: "date" } } })
    ).toBe("created: tomorrow");
  });

  it("combines date conversion with an alias", () => {
    expect(
      json2ai({ at: 1756814400 }, { rename: { at: { alias: "when", type: "date" } } })
    ).toBe("when: 2025-09-02T12:00:00.000Z");
  });

  it("gives type precedence over unit on a date leaf", () => {
    expect(
      json2ai({ at: 1756814400 }, { rename: { at: { type: "date", unit: "s" } } })
    ).toBe("at: 2025-09-02T12:00:00.000Z");
  });

  it("applies date transform to an array of primitive leaves", () => {
    expect(
      json2ai({ times: [1756814400, 1756814400000] }, { rename: { times: { type: "date" } } })
    ).toBe("times:\n 2025-09-02T12:00:00.000Z, 2025-09-02T12:00:00.000Z");
  });

  it("applies unit to an array of primitive leaves", () => {
    expect(
      json2ai({ prices: [10, 20] }, { rename: { prices: { unit: "USD" } } })
    ).toBe("prices:\n 10 USD, 20 USD");
  });
});