export type Json2AiFormat = "md" | "tsv";

export interface Json2AiOptions {
  /**
   * Indentation string for nested objects. Defaults to a single space to keep
   * output compact.
   */
  indent?: string;
  /**
   * Table format used for arrays of homogeneous objects. `"md"` renders a
   * Markdown table (friendlier for LLMs, slightly more tokens); `"tsv"` uses
   * the compact tab-separated form of earlier versions (fewer tokens).
   * Defaults to `"md"`.
   */
  format?: Json2AiFormat;
  /**
   * When arrays are large, show only the first N items and summarize the rest.
   * Defaults to undefined (no truncation).
   */
  maxArrayItems?: number;
  /**
   * Wrap the output in a Markdown fenced code block. Defaults to false.
   */
  wrapInCodeBlock?: boolean;
  /**
   * Fence language used when `wrapInCodeBlock` is true. Defaults to "text".
   */
  codeBlockLang?: string;
  /**
   * Strip keys matching these paths from the output (e.g. ["headers", "sensitive"]).
   * Useful for removing secrets before feeding data to an AI. Defaults to [].
   */
  omit?: string[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const escapeCodeBlock = (value: string): string =>
  value.replace(/```/g, "\\`\\`\\`");

/**
 * Render a value in the compact inline style: objects as `k:v` pairs, arrays
 * as comma-free space-separated lists, scalars unquoted unless ambiguous.
 * Used to fuse nested sub-objects into a single table cell without creating
 * another table.
 */
function formatInline(value: unknown, omitSet: Set<string>): string {
  if (isPlainObject(value)) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      if (omitSet.has(k)) continue;
      parts.push(`${k}:${formatInline(v, omitSet)}`);
    }
    return `{${parts.join(" ")}}`;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatInline(item, omitSet))
      .filter((s) => s !== "");
    if (items.length === 0) return "[]";
    return `[${items.join(" ")}]`;
  }
  return formatPrimitiveInline(value);
}

function formatPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") return `${value}n`;
  if (value === undefined) return "undefined";
  return String(value);
}

/**
 * Inline-safe primitive: quote strings that would be ambiguous when fused into
 * a compact cell (spaces, punctuation, brackets) so they stay readable.
 */
function formatPrimitiveInline(value: unknown): string {
  if (typeof value === "string") {
    if (/[\s:,[\]{}|]/.test(value)) {
      return `"${value.replace(/"/g, '\\"').replace(/\|/g, "\\|")}"`;
    }
    return value;
  }
  return formatPrimitive(value);
}

/**
 * Column layout for a table: each column is either a flat scalar leaf (read
 * back by exact key) or an inline-fused subtree (object/array, rendered with
 * `formatInline`).
 */
interface Column {
  name: string;
  inline: boolean;
}

/**
 * Infer the column layout for an array of objects. Scalar leaves become
 * columns; container subtrees (objects/arrays) become a single fused inline
 * column. Returns null when the rows are irregular (mismatched keys), empty,
 * or would render too wide.
 */
function inferColumns(
  rows: Record<string, unknown>[],
  omitSet: Set<string>,
  maxCols: number,
  maxCellLen: number
): Column[] | null {
  // Collect the top-level fields of the row, tagging whether each is a scalar
  // leaf or a container. Container internals are fused into a single inline
  // cell, so only the top-level container identity matters.
  const signatureOf = (row: Record<string, unknown>): string[] => {
    const sig: string[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (omitSet.has(k)) continue;
      if (isPlainObject(v) || Array.isArray(v)) {
        sig.push(`${k}*`);
      } else {
        sig.push(`${k}#`);
      }
    }
    return sig;
  };

  const base = signatureOf(rows[0]!);
  for (let i = 1; i < rows.length; i++) {
    const sig = signatureOf(rows[i]!);
    if (sig.length !== base.length) return null;
    for (let j = 0; j < sig.length; j++) {
      if (sig[j] !== base[j]) return null;
    }
  }

  if (base.length === 0 || base.length > maxCols) return null;

  // Fuse: a top-level container becomes one inline column; scalar leaves keep
  // their full dotted path as a column. Any scalar leaf nested under a
  // container is folded into that container's fused cell instead.
  const isLeaf = (entry: string): boolean => entry.endsWith("#");
  const containers = base
    .filter((e) => !isLeaf(e))
    .map((e) => e.slice(0, -1));
  const scalarLeaves = base
    .filter(isLeaf)
    .filter((e) => {
      const path = e.slice(0, -1);
      return !containers.some((c) => c && path.startsWith(`${c}.`));
    });

  const sorted = [...scalarLeaves, ...containers.map((c) => `${c}*`)];
  if (sorted.length === 0 || sorted.length > maxCols) return null;

  const columns: Column[] = sorted.map((entry) => ({
    name: entry.endsWith("*") ? entry.slice(0, -1) : entry.slice(0, -1),
    inline: entry.endsWith("*"),
  }));

  // Width guard: bail out of table mode when any cell renders too long.
  for (const row of rows) {
    for (const col of columns) {
      const value = valueAtPath(row, col.name);
      const cell = col.inline
        ? formatInline(value, omitSet)
        : formatPrimitive(value);
      if (cell.length > maxCellLen) return null;
    }
  }

  return columns;
}

function valueAtPath(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function formatValue(
  value: unknown,
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>,
  format: Json2AiFormat
): string {
  if (isPlainObject(value)) {
    return formatObject(value, depth, indent, maxArrayItems, omitSet, format);
  }
  if (Array.isArray(value)) {
    return formatArray(value, depth, indent, maxArrayItems, omitSet, format);
  }
  return formatPrimitive(value);
}

function formatObject(
  obj: Record<string, unknown>,
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>,
  format: Json2AiFormat
): string {
  const entries = Object.entries(obj);

  if (entries.length === 0) {
    return "{}";
  }

  const pad = indent.repeat(depth);
  const childDepth = depth + 1;
  const lines: string[] = [];

  for (const [key, val] of entries) {
    if (omitSet.has(key)) continue;
    const isContainer = isPlainObject(val) || Array.isArray(val);
    const body = formatValue(val, childDepth, indent, maxArrayItems, omitSet, format);
    if (isContainer && body !== "{}" && body !== "[]") {
      lines.push(`${pad}${key}:`);
      lines.push(body);
    } else {
      lines.push(`${pad}${key}: ${body}`);
    }
  }

  return lines.join("\n");
}

function formatArray(
  arr: unknown[],
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>,
  format: Json2AiFormat
): string {
  if (arr.length === 0) {
    return "[]";
  }

  const pad = indent.repeat(depth);

  if (maxArrayItems !== undefined && arr.length > maxArrayItems) {
    const shown = arr.slice(0, maxArrayItems);
    const skipped = arr.length - maxArrayItems;
    const body = formatArrayBody(shown, depth, indent, maxArrayItems, omitSet, format);
    return `${body}\n${pad}... (${skipped} more)[${arr.length}]`;
  }

  return formatArrayBody(arr, depth, indent, maxArrayItems, omitSet, format);
}

function formatArrayBody(
  arr: unknown[],
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>,
  format: Json2AiFormat
): string {
  const pad = indent.repeat(depth);

  // Array of primitives: render as a single-line compact inline list.
  if (
    arr.length > 0 &&
    arr.every((item) => !isPlainObject(item) && !Array.isArray(item))
  ) {
    return `${pad}${arr.map((item) => formatPrimitiveInline(item)).join(", ")}`;
  }

  if (arr.length > 0 && arr.every(isPlainObject)) {
    const objects = arr as Record<string, unknown>[];
    const columns = inferColumns(objects, omitSet, 20, 80);
    if (columns) {
      return format === "md"
        ? renderMdTable(objects, columns, omitSet, pad)
        : renderTsvTable(objects, columns, omitSet, pad);
    }
  }

  // Fallback: nested / heterogeneous items, expand each value.
  return arr
    .map((item, i) => {
      if (isPlainObject(item) || Array.isArray(item)) {
        const body = formatValue(item, depth + 1, indent, maxArrayItems, omitSet, format);
        return `${pad}${i}:\n${body}`;
      }
      const v = formatPrimitive(item).replace(/\s+/g, " ").trim();
      return `${pad}${i} ${v}`;
    })
    .join("\n");
}

function renderMdTable(
  rows: Record<string, unknown>[],
  columns: Column[],
  omitSet: Set<string>,
  pad: string
): string {
  const header = ["index", ...columns.map((c) => c.name)].join(" | ");
  const sep = ["---", ...columns.map(() => "---")].join(" | ");
  const lines: string[] = [];
  lines.push(`${pad}| ${header} |`);
  lines.push(`${pad}| ${sep} |`);
  rows.forEach((row, i) => {
    const cells = columns.map((c) => {
      const value = valueAtPath(row, c.name);
      const raw = c.inline
        ? formatInline(value, omitSet)
        : formatPrimitive(value);
      return escapeCell(raw);
    });
    lines.push(`${pad}| ${i} | ${cells.join(" | ")} |`);
  });
  return lines.join("\n");
}

function renderTsvTable(
  rows: Record<string, unknown>[],
  columns: Column[],
  omitSet: Set<string>,
  pad: string
): string {
  const header = columns.map((c) => c.name).join("\t");
  const lines: string[] = [];
  lines.push(`${pad}index\t${header}`);
  rows.forEach((row, i) => {
    const cells = columns.map((c) => {
      const value = valueAtPath(row, c.name);
      const raw = c.inline
        ? formatInline(value, omitSet)
        : formatPrimitive(value);
      return raw.replace(/[\t\n]/g, " ");
    });
    lines.push(`${pad}${i}\t${cells.join("\t")}`);
  });
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Convert a JavaScript value into a compact Markdown representation that is
 * friendly for reading by LLMs / AI tools. Arrays of homogeneous objects are
 * rendered as tables; nested sub-objects are fused into cells as compact
 * inline JSON.
 */
export function json2ai(
  value: unknown,
  options: Json2AiOptions = {}
): string {
  const {
    indent = " ",
    format = "md",
    maxArrayItems,
    wrapInCodeBlock = false,
    codeBlockLang = "text",
    omit = [],
  } = options;

  const omitSet = new Set(omit);

  let output: string;

  if (isPlainObject(value)) {
    output = formatObject(value, 0, indent, maxArrayItems, omitSet, format);
  } else if (Array.isArray(value)) {
    output = formatArray(value, 0, indent, maxArrayItems, omitSet, format);
  } else {
    output = formatPrimitive(value);
  }

  output = escapeCodeBlock(output);

  if (wrapInCodeBlock) {
    output = `\`\`\`${codeBlockLang}\n${output}\n\`\`\``;
  }
  return output;
}

export default json2ai;