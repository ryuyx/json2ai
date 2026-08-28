# json2ai

Convert JSON into compact, AI-friendly Markdown. Reduces token usage and
formats nested data for readable consumption by LLM-based tools.

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
});
```

Produces:

```text
user:
 id: 1
 name: ryuyx
 active: true
tags:
 0: ts
 1: node
```

## API

`json2ai(value, options?) => string`

### Options

| Option           | Type       | Default | Description                                                       |
| ---------------- | ---------- | ------- | ----------------------------------------------------------------- |
| `indent`         | `string`   | `" "`   | Indentation string for nested objects.                            |
| `maxArrayItems`  | `number`   | —       | Truncate large arrays, summarizing skipped items with a count.    |
| `wrapInCodeBlock`| `boolean`  | `false` | Wrap output in a fenced Markdown code block.                      |
| `codeBlockLang`  | `string`   | `"json"`| Fence language for `wrapInCodeBlock`.                             |
| `omit`           | `string[]` | `[]`    | Key names to drop (e.g. secrets). Matches key names at any depth. |

## License

MIT