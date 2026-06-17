import type { EditorPosition } from "./languageServerFeatures";

export interface PhpImplementationGutterTarget {
  methodName: string;
  position: EditorPosition;
}

const interfaceDeclarationPattern =
  /\binterface\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+extends\s+[^{]+)?\s*\{/g;
const methodDeclarationPattern =
  /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

export function phpImplementationGutterTargets(
  source: string,
): PhpImplementationGutterTarget[] {
  const targets: PhpImplementationGutterTarget[] = [];

  for (const declaration of source.matchAll(interfaceDeclarationPattern)) {
    const openBrace = (declaration.index ?? 0) + declaration[0].lastIndexOf("{");
    const closeBrace = matchingBraceOffset(source, openBrace);
    const bodyEnd = closeBrace ?? source.length;
    const body = source.slice(openBrace + 1, bodyEnd);

    for (const method of body.matchAll(methodDeclarationPattern)) {
      const methodName = method[1] || "";
      const methodOffset =
        openBrace + 1 + (method.index ?? 0) + method[0].indexOf(methodName);

      targets.push({
        methodName,
        position: lineColumnAt(source, methodOffset),
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

function lineColumnAt(source: string, offset: number): EditorPosition {
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineNumber += 1;
    lineStart = index + 1;
  }

  return {
    column: offset - lineStart + 1,
    lineNumber,
  };
}
