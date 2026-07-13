import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";
import { missingLatteTemplateReferenceAt } from "./netteTemplateReferences";

export function netteLatteReferenceDiagnostics(
  source: string,
  currentTemplateRelativePath: string,
  templateRelativePaths: readonly string[],
): LanguageServerDiagnostic[] {
  if (templateRelativePaths.length === 0) {
    return [];
  }

  const diagnostics: LanguageServerDiagnostic[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (offset < source.length) {
    const missing = missingLatteTemplateReferenceAt(
      source,
      offset,
      currentTemplateRelativePath,
      templateRelativePaths,
    );

    if (!missing) {
      offset += 1;
      continue;
    }

    const key = `${missing.relativePath}\0${missing.nameStart}`;

    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(
        diagnosticForMissingTemplate(source, {
          name: missing.name,
          nameEnd: missing.nameEnd,
          nameStart: missing.nameStart,
          relativePath: missing.relativePath,
        }),
      );
    }

    offset = Math.max(offset + 1, missing.nameEnd);
  }

  return diagnostics;
}

function diagnosticForMissingTemplate(
  source: string,
  missing: {
    name: string;
    nameEnd: number;
    nameStart: number;
    relativePath: string;
  },
): LanguageServerDiagnostic {
  const start = lineCharacterAtOffset(source, missing.nameStart);
  const end = lineCharacterAtOffset(source, missing.nameEnd);

  return {
    character: start.character,
    code: "nette.missingTemplate",
    data: {
      kind: "missing-template",
      name: missing.name,
      relativePath: missing.relativePath,
    },
    endCharacter: end.character,
    endLine: end.line,
    line: start.line,
    message: `No Nette Latte template ${missing.name} was found.`,
    severity: "warning",
    source: "Nette",
  };
}

function lineCharacterAtOffset(
  source: string,
  offset: number,
): { character: number; line: number } {
  const target = Math.max(0, Math.min(offset, source.length));
  let character = 0;
  let line = 0;

  for (let index = 0; index < target; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      character = 0;
      continue;
    }

    character += 1;
  }

  return { character, line };
}
