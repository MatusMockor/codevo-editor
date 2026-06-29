export interface PhpSyntaxDiagnostic {
  character: number;
  endCharacter: number;
  endLine: number;
  line: number;
  message: string;
}

export interface PhpSyntaxDiagnosticsGateway {
  validate(source: string): Promise<PhpSyntaxDiagnostic[]>;
}

const bareIdentifierStatementPattern =
  /(^|[;{}])([ \t]*)([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?=;)/gm;
const phpReservedBareIdentifiers = new Set([
  "break",
  "continue",
  "declare",
  "die",
  "echo",
  "exit",
  "false",
  "global",
  "null",
  "print",
  "return",
  "static",
  "throw",
  "true",
  "yield",
]);
const likelyConstantIdentifierPattern = /^[A-Z_][A-Z0-9_]*$/;

export function suspiciousPhpBareIdentifierDiagnostics(
  source: string,
): PhpSyntaxDiagnostic[] {
  return Array.from(source.matchAll(bareIdentifierStatementPattern))
    .map((match) => toBareIdentifierCandidate(source, match))
    .filter((candidate) => shouldReportBareIdentifierCandidate(candidate))
    .map((match) => {
      const start = lineCharacterAt(source, match.startOffset);

      return {
        character: start.character,
        endCharacter: start.character + match.identifier.length,
        endLine: start.line,
        line: start.line,
        message: `Unexpected bare PHP identifier "${match.identifier}".`,
      };
    });
}

export function structuralPhpSyntaxDiagnostics(
  source: string,
): PhpSyntaxDiagnostic[] {
  const stack: Array<{ character: number; expected: string; line: number }> = [];
  let line = 0;
  let character = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaping = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        line += 1;
        character = 0;
      } else {
        character += 1;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
        character += 2;
        continue;
      }

      if (char === "\n") {
        line += 1;
        character = 0;
      } else {
        character += 1;
      }
      continue;
    }

    if (quote) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === quote) {
        quote = null;
      }

      if (char === "\n") {
        line += 1;
        character = 0;
      } else {
        character += 1;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      character += 2;
      continue;
    }

    if (char === "#") {
      inLineComment = true;
      character += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      character += 2;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      character += 1;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      stack.push({ character, expected: closingDelimiterFor(char), line });
    } else if (char === ")" || char === "]" || char === "}") {
      const opening = stack[stack.length - 1];

      if (opening?.expected === char) {
        stack.pop();
      }
    }

    if (char === "\n") {
      line += 1;
      character = 0;
    } else {
      character += 1;
    }
  }

  const unclosed = stack[stack.length - 1];

  if (!unclosed) {
    return [];
  }

  return [
    {
      character: unclosed.character,
      endCharacter: unclosed.character + 1,
      endLine: unclosed.line,
      line: unclosed.line,
      message: `Unclosed delimiter, expected "${unclosed.expected}".`,
    },
  ];
}

interface BareIdentifierCandidate {
  identifier: string;
  previousNonWhitespace: string;
  startOffset: number;
}

function toBareIdentifierCandidate(
  source: string,
  match: RegExpMatchArray,
): BareIdentifierCandidate {
  const startOffset =
    (match.index ?? 0) + (match[1]?.length ?? 0) + (match[2]?.length ?? 0);

  return {
    identifier: match[3] || "",
    previousNonWhitespace: previousNonWhitespaceBefore(source, startOffset),
    startOffset,
  };
}

function shouldReportBareIdentifierCandidate(
  candidate: BareIdentifierCandidate,
): boolean {
  if (!candidate.identifier) {
    return false;
  }

  if (candidate.previousNonWhitespace === ",") {
    return false;
  }

  if (phpReservedBareIdentifiers.has(candidate.identifier.toLowerCase())) {
    return false;
  }

  return !likelyConstantIdentifierPattern.test(candidate.identifier);
}

function previousNonWhitespaceBefore(source: string, offset: number): string {
  for (let index = offset - 1; index >= 0; index -= 1) {
    const char = source[index] ?? "";

    if (/\s/.test(char)) {
      continue;
    }

    return char;
  }

  return "";
}

function closingDelimiterFor(delimiter: string): string {
  if (delimiter === "(") {
    return ")";
  }

  if (delimiter === "[") {
    return "]";
  }

  return "}";
}

function lineCharacterAt(
  source: string,
  offset: number,
): { character: number; line: number } {
  let line = 0;
  let lineStart = 0;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    line += 1;
    lineStart = index + 1;
  }

  return {
    character: offset - lineStart,
    line,
  };
}
