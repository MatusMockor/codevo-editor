type MaskFrame = { kind: "template" } | { depth: number; kind: "expression" };

/**
 * Replaces JavaScript/TypeScript strings, templates, comments and recognizable
 * regex literals with spaces while preserving offsets and line breaks.
 */
export function maskJavaScriptSource(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let lastMaskedLiteralEnd = -1;
  const frames: MaskFrame[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (inLineComment) {
      output += maskedCharacter(character);
      if (character === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      output += maskedCharacter(character);
      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (quote) {
      output += maskedCharacter(character);
      if (character === "\\") {
        output += maskedCharacter(next);
        index += 1;
      } else if (character === quote || character === "\n") {
        if (character === quote) lastMaskedLiteralEnd = index;
        quote = null;
      }
      continue;
    }

    const top = frames[frames.length - 1];
    if (top?.kind === "template") {
      output += maskedCharacter(character);
      if (character === "\\") {
        output += maskedCharacter(next);
        index += 1;
      } else if (character === "`") {
        lastMaskedLiteralEnd = index;
        frames.pop();
      } else if (character === "$" && next === "{") {
        output += " ";
        index += 1;
        frames.push({ depth: 0, kind: "expression" });
      }
      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "/" && canStartRegexLiteral(output, lastMaskedLiteralEnd)) {
      const regexEnd = regexLiteralEnd(source, index);
      if (regexEnd !== null) {
        for (let cursor = index; cursor <= regexEnd; cursor += 1) {
          output += maskedCharacter(source[cursor] ?? "");
        }
        lastMaskedLiteralEnd = regexEnd;
        index = regexEnd;
        continue;
      }
    }

    if (character === "'" || character === '"') {
      output += " ";
      quote = character;
      continue;
    }

    if (character === "`") {
      output += " ";
      frames.push({ kind: "template" });
      continue;
    }

    if (top?.kind === "expression") {
      output += maskedCharacter(character);
      if (character === "{") top.depth += 1;
      else if (character === "}" && top.depth === 0) frames.pop();
      else if (character === "}") top.depth -= 1;
      continue;
    }

    output += character;
  }

  return output;
}

function maskedCharacter(character: string): string {
  return character === "\n" ? "\n" : " ";
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);
const REGEX_CONTROL_HEADER_KEYWORDS = new Set(["catch", "for", "if", "while", "with"]);

function canStartRegexLiteral(maskedPrefix: string, lastMaskedLiteralEnd: number): boolean {
  if (
    lastMaskedLiteralEnd >= 0 &&
    maskedPrefix.slice(lastMaskedLiteralEnd + 1).trim() === ""
  ) {
    return false;
  }
  let index = maskedPrefix.length - 1;
  while (index >= 0 && /\s/.test(maskedPrefix[index] ?? "")) index -= 1;
  if (index < 0) return true;

  const previous = maskedPrefix[index] ?? "";
  if ("([{,:;=!?&|+-*%^~<>/".includes(previous)) return true;
  if (previous === ")") return closesControlHeader(maskedPrefix, index);
  if (!/[\w$]/.test(previous)) return false;

  const end = index + 1;
  while (index >= 0 && /[\w$]/.test(maskedPrefix[index] ?? "")) index -= 1;
  return REGEX_PREFIX_KEYWORDS.has(maskedPrefix.slice(index + 1, end));
}

function closesControlHeader(maskedPrefix: string, closeOffset: number): boolean {
  let depth = 1;
  let index = closeOffset - 1;
  for (; index >= 0; index -= 1) {
    const character = maskedPrefix[index] ?? "";
    if (character === ")") depth += 1;
    else if (character === "(") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return false;

  index -= 1;
  while (index >= 0 && /\s/.test(maskedPrefix[index] ?? "")) index -= 1;
  const keywordEnd = index + 1;
  while (index >= 0 && /[\w$]/.test(maskedPrefix[index] ?? "")) index -= 1;
  return REGEX_CONTROL_HEADER_KEYWORDS.has(maskedPrefix.slice(index + 1, keywordEnd));
}

function regexLiteralEnd(source: string, from: number): number | null {
  let inCharacterClass = false;
  for (let index = from + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (character === "\n" || character === "\r") return null;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (character === "/" && !inCharacterClass) {
      while (/[a-z]/i.test(source[index + 1] ?? "")) index += 1;
      return index;
    }
  }
  return null;
}
