export type Json2AiFormat = "md" | "tsv";

export interface RenameSpec {
  /**
   * Alias to display instead of the source key name. Optional: omit to keep
   * the key name unchanged while still applying a unit or date transform.
   */
  alias?: string;
  /**
   * Unit suffix appended to the leaf value when it renders as a scalar
   * (e.g. "USD" turns `price: 100` into `price: 100 USD`). Ignored when the
   * matched path holds an object or array.
   */
  unit?: string;
  /**
   * When `"date"`, convert a numeric leaf value to an ISO 8601 UTC timestamp,
   * auto-detecting seconds vs milliseconds by magnitude (`>= 1e12` is
   * milliseconds, otherwise seconds). Non-numeric values pass through
   * unchanged. When both `unit` and `type` are set and the value is a number,
   * `type` takes precedence.
   */
  type?: "date";
}

export type RenameValue = string | RenameSpec;

export type RenameMap = Record<string, RenameValue>;

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
  /**
   * Remap selected keys by dotted path: map a source path (e.g. "user.name") to
   * either an alias string or an object with an optional `alias`, optional `unit`
   * suffix, and/or optional `type: "date"` conversion
   * (e.g. { alias: "username" }, { unit: "USD" }, or { type: "date" }).
   * Array indices are skipped in paths, so a path like "users.name" matches every
   * row. Defaults to {}.
   */
  rename?: RenameMap;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const escapeCodeBlock = (value: string): string =>
  value.replace(/```/g, "\\`\\`\\`");

type NormalizedRename = Map<string, RenameSpec>;

const normalizeRename = (rename: RenameMap | undefined): NormalizedRename => {
  const map: NormalizedRename = new Map();
  if (!rename) return map;
  for (const [path, value] of Object.entries(rename)) {
    map.set(
      path,
      typeof value === "string" ? { alias: value } : { ...value }
    );
  }
  return map;
};

/**
 * Resolve the dotted path against a normalized rename map, returning the spec or
 * undefined when no entry matches. Dotted keys (keys containing ".") are not
 * supported for rename matching.
 */
const lookupRename = (
  path: string,
  rename: NormalizedRename
): RenameSpec | undefined => rename.get(path);

/**
 * Build the dotted path for a key at a given depth from the chain of ancestor
 * keys (array indices excluded, matching how `valueAtPath` addresses data).
 */
const joinPath = (parts: string[]): string => {
  const cleaned = parts.filter((p) => p !== "");
  return cleaned.join(".");
};

/**
 * Render a value in the compact inline style: objects as `k:v` pairs, arrays
 * as comma-free space-separated lists, scalars unquoted unless ambiguous.
 * Used to fuse nested sub-objects into a single table cell without creating
 * another table.
 */
function formatInline(
  value: unknown,
  omitSet: Set<string>,
  rename: NormalizedRename,
  path: string = ""
): string {
  if (isPlainObject(value)) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      if (omitSet.has(k)) continue;
      const childPath = joinPath([path, k]);
      const spec = lookupRename(childPath, rename);
      const name = spec?.alias ?? k;
      const child = formatInline(v, omitSet, rename, childPath);
      parts.push(`${name}:${child}`);
    }
    return `{${parts.join(" ")}}`;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatInline(item, omitSet, rename, path))
      .filter((s) => s !== "");
    if (items.length === 0) return "[]";
    return `[${items.join(" ")}]`;
  }
  const spec = lookupRename(path, rename);
  return applyLeafTransform(value, spec, true);
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
 * Render a scalar leaf, applying the rename spec's value transform(s): a numeric
 * leaf with `type: "date"` is converted to ISO 8601 UTC (seconds vs milliseconds
 * auto-detected by a `>= 1e12` threshold); a `unit` suffix is appended otherwise.
 * `inline` selects the inline-safe primitive renderer for fused cells.
 */
function applyLeafTransform(
  value: unknown,
  spec: RenameSpec | undefined,
  inline = false
): string {
  const numeric =
    typeof value === "number" && Number.isFinite(value) && !Array.isArray(value);
  if (numeric && spec?.type === "date") {
    const ms = value >= 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const base = inline ? formatPrimitiveInline(value) : formatPrimitive(value);
  if (spec?.unit) return `${base} ${spec.unit}`;
  return base;
}

/**
 * Column layout for a table: each column is either a flat scalar leaf (read
 * back by exact key) or an inline-fused subtree (object/array, rendered with
 * `formatInline`).
 */
interface Column {
  /** Dotted path of the column within a row (used to read cell values). */
  path: string;
  /** Full dotted path from the root (used for rename lookup and inline cells). */
  fullPath: string;
  /** Display name (alias applied). */
  name: string;
  inline: boolean;
  /** Unit suffix to append to scalar cells, if the path carries one. */
  unit?: string;
  /** Date transform for scalar cells, if the path carries one. */
  type?: RenameSpec["type"];
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
  maxCellLen: number,
  rename: NormalizedRename,
  arrayPath: string = ""
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

  const columns: Column[] = sorted.map((entry) => {
    const isInline = entry.endsWith("*");
    const path = entry.slice(0, -1);
    const fullPath = joinPath([arrayPath, path]);
    const spec = lookupRename(fullPath, rename);
    return {
      path,
      fullPath,
      name: spec?.alias ?? path,
      inline: isInline,
      unit: spec?.unit,
      type: spec?.type,
    };
  });

  // Width guard: bail out of table mode when any cell renders too long.
  for (const row of rows) {
    for (const col of columns) {
      const value = valueAtPath(row, col.path);
      const cell = col.inline
        ? formatInline(value, omitSet, rename, col.fullPath)
        : formatScalarCell(value, col.unit, col.type);
      if (cell.length > maxCellLen) return null;
    }
  }

  return columns;
}

/**
 * Render a scalar table cell, applying the column's leaf transform (unit suffix
 * and/or date conversion). Container values should not reach here (they are
 * handled by formatInline).
 */
function formatScalarCell(value: unknown, unit?: string, type?: "date"): string {
  return applyLeafTransform(value, { unit, type }, false);
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
  format: Json2AiFormat,
  rename: NormalizedRename,
  path: string = ""
): string {
  if (isPlainObject(value)) {
    return formatObject(value, depth, indent, maxArrayItems, omitSet, format, rename, path);
  }
  if (Array.isArray(value)) {
    return formatArray(value, depth, indent, maxArrayItems, omitSet, format, rename, path);
  }
  const spec = lookupRename(path, rename);
  return applyLeafTransform(value, spec, false);
}

function formatObject(
  obj: Record<string, unknown>,
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>,
  format: Json2AiFormat,
  rename: NormalizedRename,
  path: string = ""
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
    const keyPath = joinPath([path, key]);
    const spec = lookupRename(keyPath, rename);
    const name = spec?.alias ?? key;
    const isContainer = isPlainObject(val) || Array.isArray(val);
    const body = formatValue(val, childDepth, indent, maxArrayItems, omitSet, format, rename, keyPath);
    if (isContainer && body !== "{}" && body !== "[]") {
      lines.push(`${pad}${name}:`);
      lines.push(body);
    } else {
      lines.push(`${pad}${name}: ${body}`);
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
  format: Json2AiFormat,
  rename: NormalizedRename,
  path: string = ""
): string {
  if (arr.length === 0) {
    return "[]";
  }

  const pad = indent.repeat(depth);

  if (maxArrayItems !== undefined && arr.length > maxArrayItems) {
    const shown = arr.slice(0, maxArrayItems);
    const skipped = arr.length - maxArrayItems;
    const body = formatArrayBody(shown, depth, indent, maxArrayItems, omitSet, format, rename, path);
    return `${body}\n${pad}... (${skipped} more)[${arr.length}]`;
  }

  return formatArrayBody(arr, depth, indent, maxArrayItems, omitSet, format, rename, path);
}

function formatArrayBody(
  arr: unknown[],
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>,
  format: Json2AiFormat,
  rename: NormalizedRename,
  path: string = ""
): string {
  const pad = indent.repeat(depth);

  // Array of primitives: render as a single-line compact inline list. Apply the
  // array path's leaf transform (unit/date) per element, so e.g. a `type: "date"`
  // on the array path converts each timestamp consistently with the scalar case.
  if (
    arr.length > 0 &&
    arr.every((item) => !isPlainObject(item) && !Array.isArray(item))
  ) {
    const spec = lookupRename(path, rename);
    return `${pad}${arr
      .map((item) => applyLeafTransform(item, spec, true))
      .join(", ")}`;
  }

  if (arr.length > 0 && arr.every(isPlainObject)) {
    const objects = arr as Record<string, unknown>[];
    const columns = inferColumns(objects, omitSet, 20, 80, rename, path);
    if (columns) {
      return format === "md"
        ? renderMdTable(objects, columns, omitSet, pad, rename)
        : renderTsvTable(objects, columns, omitSet, pad, rename);
    }
  }

  // Fallback: nested / heterogeneous items, expand each value.
  return arr
    .map((item, i) => {
      if (isPlainObject(item) || Array.isArray(item)) {
        const body = formatValue(item, depth + 1, indent, maxArrayItems, omitSet, format, rename, path);
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
  pad: string,
  rename: NormalizedRename
): string {
  const header = ["index", ...columns.map((c) => c.name)].join(" | ");
  const sep = ["---", ...columns.map(() => "---")].join(" | ");
  const lines: string[] = [];
  lines.push(`${pad}| ${header} |`);
  lines.push(`${pad}| ${sep} |`);
  rows.forEach((row, i) => {
    const cells = columns.map((c) => {
      const value = valueAtPath(row, c.path);
      const raw = c.inline
        ? formatInline(value, omitSet, rename, c.fullPath)
        : formatScalarCell(value, c.unit, c.type);
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
  pad: string,
  rename: NormalizedRename
): string {
  const header = columns.map((c) => c.name).join("\t");
  const lines: string[] = [];
  lines.push(`${pad}index\t${header}`);
  rows.forEach((row, i) => {
    const cells = columns.map((c) => {
      const value = valueAtPath(row, c.path);
      const raw = c.inline
        ? formatInline(value, omitSet, rename, c.fullPath)
        : formatScalarCell(value, c.unit, c.type);
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
    rename,
  } = options;

  const omitSet = new Set(omit);
  const renameMap = normalizeRename(rename);

  let output: string;

  if (isPlainObject(value)) {
    output = formatObject(value, 0, indent, maxArrayItems, omitSet, format, renameMap, "");
  } else if (Array.isArray(value)) {
    output = formatArray(value, 0, indent, maxArrayItems, omitSet, format, renameMap, "");
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