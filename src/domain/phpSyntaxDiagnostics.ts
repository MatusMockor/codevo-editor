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
    .filter((match) => shouldReportBareIdentifier(match[3] || ""))
    .map((match) => {
      const identifier = match[3] || "";
      const startOffset =
        (match.index ?? 0) + (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
      const start = lineCharacterAt(source, startOffset);

      return {
        character: start.character,
        endCharacter: start.character + identifier.length,
        endLine: start.line,
        line: start.line,
        message: `Unexpected bare PHP identifier "${identifier}".`,
      };
    });
}

function shouldReportBareIdentifier(identifier: string): boolean {
  if (!identifier) {
    return false;
  }

  if (phpReservedBareIdentifiers.has(identifier.toLowerCase())) {
    return false;
  }

  return !likelyConstantIdentifierPattern.test(identifier);
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
