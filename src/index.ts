export interface Json2AiOptions {
  /**
   * Indentation string for nested objects inside a Markdown code block.
   * Defaults to a single space to keep output compact.
   */
  indent?: string;
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
   * Fence language used when `wrapInCodeBlock` is true. Defaults to "json".
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
 * Convert a JavaScript value into a compact Markdown representation that is
 * friendly for reading by LLMs / AI tools.
 *
 * @example
 * json2ai({ user: { id: 1 }, tags: ["a", "b"] })
 * // user:
 * //   id: 1
 * // tags:
 * //   0: a
 * //   1: b
 */
export function json2ai(
  value: unknown,
  options: Json2AiOptions = {}
): string {
  const {
    indent = " ",
    maxArrayItems,
    wrapInCodeBlock = false,
    codeBlockLang = "json",
    omit = [],
  } = options;

  const omitSet = new Set(omit);

  let output: string;

  if (isPlainObject(value)) {
    output = formatObject(value, 0, indent, maxArrayItems, omitSet);
  } else if (Array.isArray(value)) {
    output = formatArray(value, 0, indent, maxArrayItems, omitSet);
  } else {
    output = formatPrimitive(value);
  }

  output = escapeCodeBlock(output);

  if (wrapInCodeBlock) {
    output = `\`\`\`${codeBlockLang}\n${output}\n\`\`\``;
  }
  return output;
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

function formatValue(
  value: unknown,
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>
): string {
  if (isPlainObject(value)) {
    return formatObject(value, depth, indent, maxArrayItems, omitSet);
  }
  if (Array.isArray(value)) {
    return formatArray(value, depth, indent, maxArrayItems, omitSet);
  }
  return formatPrimitive(value);
}

function formatObject(
  obj: Record<string, unknown>,
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>
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
    const body = formatValue(val, childDepth, indent, maxArrayItems, omitSet);
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
  omitSet: Set<string>
): string {
  if (arr.length === 0) {
    return "[]";
  }

  const pad = indent.repeat(depth);
  const childDepth = depth + 1;

  if (maxArrayItems !== undefined && arr.length > maxArrayItems) {
    const shown = arr.slice(0, maxArrayItems);
    const body = shown
      .map((item) => `${pad}${indent}- ${formatValue(item, 0, indent, maxArrayItems, omitSet)}`)
      .join("\n");
    const skipped = arr.length - maxArrayItems;
    return `${body}\n${pad}... (${skipped} more)[${arr.length}]`;
  }

  return arr
    .map((item, i) => `${pad}${i}: ${formatValue(item, childDepth, indent, maxArrayItems, omitSet)}`)
    .join("\n");
}

export default json2ai;