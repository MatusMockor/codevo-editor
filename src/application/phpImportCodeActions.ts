import {
  phpCurrentNamespace,
  phpShortNameIsImported,
  planPhpAddImport,
} from "../domain/phpAddImport";
import { offsetToPosition } from "../domain/phpInsertionPoint";
import { organizePhpImports } from "../domain/phpImportsOrganizer";
import { phpClassIdentifierNameAt } from "../domain/phpNavigation";
import { zeroLengthPhpEditRange } from "./phpCodeActionEdits";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export function phpImportClassShortNameAt(
  source: string,
  range: PhpCodeActionRange,
): string | null {
  const shortName = phpClassIdentifierNameAt(source, range.start);

  if (!shortName || shortName.includes("\\")) {
    return null;
  }

  if (phpShortNameIsImported(source, shortName)) {
    return null;
  }

  return shortName;
}

export function phpImportClassCodeActions(
  source: string,
  candidateFqns: readonly string[],
): PhpCodeActionDescriptor[] {
  const currentNamespace = (phpCurrentNamespace(source) ?? "").toLowerCase();
  const seen = new Set<string>();
  const actions: PhpCodeActionDescriptor[] = [];

  for (const candidate of candidateFqns) {
    const fqn = candidate.trim().replace(/^\\+/, "");

    if (!fqn.includes("\\")) {
      continue;
    }

    const key = fqn.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const namespacePart = fqn.slice(0, fqn.lastIndexOf("\\")).toLowerCase();

    if (namespacePart === currentNamespace) {
      continue;
    }

    const action = phpImportClassCodeAction(source, fqn);

    if (action) {
      actions.push(action);
    }
  }

  const sorted = actions.sort((a, b) => a.title.localeCompare(b.title));

  return sorted.map((action, index) =>
    index === 0 ? action : { ...action, isPreferred: false },
  );
}

export function phpOptimizeImportsCodeAction(
  source: string,
): PhpCodeActionDescriptor | null {
  const organized = organizePhpImports(source);

  if (!organized || !organized.changed) {
    return null;
  }

  const useBlockRange = phpTopLevelUseBlockRange(source);

  if (!useBlockRange) {
    return null;
  }

  const startPosition = offsetToPosition(source, useBlockRange.start);
  const endPosition = offsetToPosition(source, useBlockRange.end);

  return {
    edits: [
      {
        range: {
          endColumn: endPosition.column + 1,
          endLineNumber: endPosition.line + 1,
          startColumn: startPosition.column + 1,
          startLineNumber: startPosition.line + 1,
        },
        text: organized.organizedUseBlock,
      },
    ],
    kind: "source.organizeImports",
    title: "Optimize imports",
  };
}

function phpImportClassCodeAction(
  source: string,
  fqn: string,
): PhpCodeActionDescriptor | null {
  const plan = planPhpAddImport(source, fqn);

  if (!plan) {
    return null;
  }

  const insertionPosition = offsetToPosition(source, plan.offset);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: plan.text,
      },
    ],
    isPreferred: true,
    kind: "quickfix",
    title: `Import ${fqn}`,
  };
}

function phpTopLevelUseBlockRange(
  source: string,
): { end: number; start: number } | null {
  const masked = phpMaskStringsAndComments(source);
  const bodyLimit = phpFirstTypeBodyOffset(masked);
  const spans: Array<{ end: number; start: number }> = [];

  for (const match of masked.matchAll(/(^|\n)([ \t]*)use\b[^;]*;/g)) {
    const lineStart = (match.index ?? 0) + match[1].length;

    if (lineStart >= bodyLimit) {
      break;
    }

    if (!phpUseStatementIsTopLevel(masked, lineStart)) {
      continue;
    }

    spans.push({
      end: lineStart + (match[0].length - match[1].length),
      start: lineStart,
    });
  }

  if (spans.length === 0) {
    return null;
  }

  if (!phpUseSpansAreContiguous(source, spans)) {
    return null;
  }

  return { end: spans[spans.length - 1].end, start: spans[0].start };
}

function phpUseSpansAreContiguous(
  source: string,
  spans: ReadonlyArray<{ end: number; start: number }>,
): boolean {
  for (let index = 1; index < spans.length; index += 1) {
    const gap = source.slice(spans[index - 1].end, spans[index].start);

    if (gap.trim().length > 0) {
      return false;
    }
  }

  return true;
}

function phpUseStatementIsTopLevel(masked: string, offset: number): boolean {
  let braceDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < offset && index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
  }

  return braceDepth === 0 && parenDepth === 0;
}

function phpFirstTypeBodyOffset(masked: string): number {
  const match =
    /(?<![:\\$>A-Za-z0-9_])(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/.exec(
      masked,
    );

  if (!match) {
    return masked.length;
  }

  const bodyStart = masked.indexOf("{", match.index + match[0].length);

  if (bodyStart < 0) {
    return masked.length;
  }

  return bodyStart + 1;
}

function phpMaskStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : " ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#" && next !== "[" && source[index - 1] !== "$") {
      output += " ";
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}
