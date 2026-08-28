# json2ai

Convert JSON into a compact, AI-friendly text format. Reduces token usage and
formats nested data for readable consumption by LLM-based tools. Optionally wrap
output in a Markdown fenced code block.

## Install

```bash
npm install json2ai
```

## Usage

```ts
import json2ai from "json2ai";

const out = json2ai({
  user: { id: 1, name: "ryuyx", active: true },
  tags: ["ts", "node"],
  users: [
    { id: 1, name: "a" },
    { id: 2, name: "b" },
  ],
});
```

Produces:

```text
user:
 id: 1
 name: ryuyx
 active: true
tags:
 ts, node
users:
 | index | id | name |
 | --- | --- | --- |
 | 0 | 1 | a |
 | 1 | 2 | b |
```

Arrays of homogeneous objects are rendered as a Markdown table (field names emitted
once, one row per item) to avoid repeating the same keys and wasting tokens —
friendlier for LLMs than raw JSON. Nested sub-objects and sub-arrays are fused into
their cell as compact inline notation (`{u:3 r:{id:x}}`) instead of nesting deeper.

## API

`json2ai(value, options?) => string`

### Options

| Option           | Type       | Default  | Description                                                       |
| ---------------- | ---------- | -------- | ----------------------------------------------------------------- |
| `indent`         | `string`   | `" "`    | Indentation string for nested objects.                            |
| `format`         | `"md"|"tsv"`| `"md"`  | Table format for object arrays. `"md"` (friendly, +tokens) or `"tsv"` (compact, −tokens). |
| `maxArrayItems`  | `number`   | —        | Truncate large arrays, summarizing skipped items with a count.    |
| `wrapInCodeBlock`| `boolean`  | `false`  | Wrap output in a fenced Markdown code block.                      |
| `codeBlockLang`  | `string`   | `"text"` | Fence language for `wrapInCodeBlock`.                             |
| `omit`           | `string[]` | `[]`     | Key names to drop (e.g. secrets). Matches key names at any depth. |

## License

MIT