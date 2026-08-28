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

  if (maxArrayItems !== undefined && arr.length > maxArrayItems) {
    const shown = arr.slice(0, maxArrayItems);
    const skipped = arr.length - maxArrayItems;
    const body = formatArrayBody(shown, depth, indent, maxArrayItems, omitSet);
    return `${body}\n${pad}... (${skipped} more)[${arr.length}]`;
  }

  return formatArrayBody(arr, depth, indent, maxArrayItems, omitSet);
}

function formatArrayBody(
  arr: unknown[],
  depth: number,
  indent: string,
  maxArrayItems: number | undefined,
  omitSet: Set<string>
): string {
  const pad = indent.repeat(depth);
  const childDepth = depth + 1;

  // Table style for arrays of homogeneous flat objects: emit a header with the
  // field names once, then one compact row per item. This avoids repeating the
  // same keys for every element, which is both compact and AI-friendly.
  if (arr.length > 0 && arr.every(isPlainObject)) {
    const keySet = new Set<string>();
    let homogeneous = true;
    for (const obj of arr as Record<string, unknown>[]) {
      const keys = Object.keys(obj).filter((k) => !omitSet.has(k));
      if (keySet.size === 0) {
        keys.forEach((k) => keySet.add(k));
      } else if (
        keys.length !== keySet.size ||
        !keys.every((k) => keySet.has(k))
      ) {
        homogeneous = false;
        break;
      }
    }

    if (homogeneous && keySet.size > 0) {
      const keys = Array.from(keySet);
      const rows = arr.map((obj, i) => {
        const rec = obj as Record<string, unknown>;
        const cells = keys.map((k) =>
          formatPrimitive(rec[k]).replace(/\s+/g, " ").trim()
        );
        return `${pad}${i}\t${cells.join("\t")}`;
      });
      const header = `${pad}index\t${keys.join("\t")}`;
      return [header, ...rows].join("\n");
    }
  }

  // Fallback: nested / heterogeneous items, expand each value.
  return arr
    .map((item, i) => {
      if (isPlainObject(item)) {
        // Keep nested objects on their own lines under the index.
        return `${pad}${i}:\n${formatValue(item, childDepth, indent, maxArrayItems, omitSet)}`;
      }
      if (Array.isArray(item)) {
        const body = formatValue(item, childDepth, indent, maxArrayItems, omitSet);
        return `${pad}${i}:\n${body}`;
      }
      const v = formatPrimitive(item).replace(/\s+/g, " ").trim();
      return `${pad}${i} ${v}`;
    })
    .join("\n");
}

export default json2ai;