import type { EditorPosition } from "./languageServerFeatures";

export interface PhpImplementationGutterTarget {
  methodName: string;
  position: EditorPosition;
}

const interfaceDeclarationPattern =
  /\binterface\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+extends\s+[^{]+)?\s*\{/g;
const interfaceMethodDeclarationPattern =
  /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const abstractClassDeclarationPattern =
  /\babstract\s+class\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+[^{]+)?\s*\{/g;
const abstractMethodDeclarationPattern =
  /\babstract\s+(?:(?:public|protected|private|static)\s+)*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

export function phpImplementationGutterTargets(
  source: string,
): PhpImplementationGutterTarget[] {
  const lineStartOffsets = computeLineStartOffsets(source);
  const targets: PhpImplementationGutterTarget[] = [];

  targets.push(
    ...targetsFromDeclarations(source, lineStartOffsets, {
      declarationPattern: interfaceDeclarationPattern,
      methodPattern: interfaceMethodDeclarationPattern,
    }),
  );
  targets.push(
    ...targetsFromDeclarations(source, lineStartOffsets, {
      declarationPattern: abstractClassDeclarationPattern,
      methodPattern: abstractMethodDeclarationPattern,
    }),
  );

  return targets;
}

function targetsFromDeclarations(
  source: string,
  lineStartOffsets: number[],
  {
    declarationPattern,
    methodPattern,
  }: {
    declarationPattern: RegExp;
    methodPattern: RegExp;
  },
): PhpImplementationGutterTarget[] {
  const targets: PhpImplementationGutterTarget[] = [];

  for (const declaration of source.matchAll(declarationPattern)) {
    const openBrace = (declaration.index ?? 0) + declaration[0].lastIndexOf("{");
    const closeBrace = matchingBraceOffset(source, openBrace);
    const bodyEnd = closeBrace ?? source.length;
    const body = source.slice(openBrace + 1, bodyEnd);

    for (const method of body.matchAll(methodPattern)) {
      const methodName = method[1] || "";
      const methodOffset =
        openBrace + 1 + (method.index ?? 0) + method[0].indexOf(methodName);

      targets.push({
        methodName,
        position: lineColumnAt(lineStartOffsets, methodOffset),
      });
    }
  }

  return targets;
}

function matchingBraceOffset(source: string, openBrace: number): number | null {
  let depth = 0;

  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];

    if (character === "{") {
      depth += 1;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

// Precompute the byte offset at which each line starts, once per source, so
// converting a method offset to a line/column is an O(log lines) binary search
// instead of an O(offset) rescan. Without this the gutter scan is
// O(file x methods); with it the dominant cost is a single O(file) pass.
function computeLineStartOffsets(source: string): number[] {
  const lineStartOffsets = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineStartOffsets.push(index + 1);
  }

  return lineStartOffsets;
}

function lineColumnAt(
  lineStartOffsets: number[],
  offset: number,
): EditorPosition {
  let low = 0;
  let high = lineStartOffsets.length - 1;

  while (low < high) {
    const mid = (low + high + 1) >> 1;

    if (lineStartOffsets[mid] <= offset) {
      low = mid;
      continue;
    }

    high = mid - 1;
  }

  return {
    column: offset - lineStartOffsets[low] + 1,
    lineNumber: low + 1,
  };
}
