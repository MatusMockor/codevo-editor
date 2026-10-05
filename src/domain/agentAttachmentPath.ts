import { MAX_AGENT_ATTACHMENT_PATH_BYTES, isAgentAttachmentPath } from "./agentAttachment";
import { isWellFormedUnicode } from "./unicodeText";

const UTF8_ENCODER = new TextEncoder();
const SHELL_ESCAPABLE = new Set(" \\'\"$`&|;<>()[]{}*?!#~");
const SHELL_EXPRESSION = new Set("$`&|;<>()[]{}*?!~");

/**
 * Exact filesystem spelling takes precedence over a copied shell argument. Callers must
 * inspect in order and only try a fallback when inspection of the exact path fails.
 * This parses spelling only: it never expands or executes shell expressions.
 */
export function agentAttachmentPathCandidates(raw: string): readonly string[] {
  if (
    raw.length > MAX_AGENT_ATTACHMENT_PATH_BYTES ||
    /\p{Cc}/u.test(raw) ||
    !isWellFormedUnicode(raw) ||
    UTF8_ENCODER.encode(raw).byteLength > MAX_AGENT_ATTACHMENT_PATH_BYTES
  ) {
    return [];
  }
  const candidates: string[] = isAgentAttachmentPath(raw) ? [raw] : [];
  const decoded = decodeShellPath(raw);
  if (decoded !== null && isAgentAttachmentPath(decoded) && decoded !== raw) {
    candidates.push(decoded);
  }
  return candidates;
}

function decodeShellPath(raw: string): string | null {
  const argument = raw.replace(/^ +/u, "");
  let quote: "single" | "double" | null = null;
  let decoded = "";
  for (let index = 0; index < argument.length; index += 1) {
    const character = argument[index]!;
    if (quote === "single") {
      if (character === "'") quote = null;
      else decoded += character;
      continue;
    }
    if (character === "\\") {
      const escaped = argument[index + 1];
      if (
        escaped === undefined ||
        (quote === "double" ? !'\\"$`'.includes(escaped) : !SHELL_ESCAPABLE.has(escaped))
      ) {
        return null;
      }
      decoded += escaped;
      index += 1;
      continue;
    }
    if (character === '"') {
      quote = quote === "double" ? null : "double";
      continue;
    }
    if (quote === "double") {
      if (character === "$" || character === "`") return null;
    } else {
      if (character === "'") {
        quote = "single";
        continue;
      }
      if (character === " ") return /^ *$/u.test(argument.slice(index)) ? decoded : null;
      if (SHELL_EXPRESSION.has(character)) return null;
    }
    decoded += character;
  }
  return quote === null ? decoded : null;
}
