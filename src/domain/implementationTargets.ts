import type {
  EditorPosition,
  LanguageServerLocation,
} from "./languageServerFeatures";
import {
  pathFromLanguageServerUri,
  toEditorPosition,
} from "./languageServerFeatures";
import { getFileName } from "./workspace";

export interface ImplementationTarget {
  detail: string;
  id: string;
  label: string;
  path: string;
  position: EditorPosition;
}

export function implementationTargetFromLocation(
  location: LanguageServerLocation,
  source: string | null,
): ImplementationTarget | null {
  const path = pathFromLanguageServerUri(location.uri);

  if (!path) {
    return null;
  }

  const position = toEditorPosition(location.range.start);
  const namespaceName = source ? phpNamespaceName(source) : null;
  const typeName = source ? nearestPhpTypeName(source, position) : null;
  const label = typeName ?? getFileName(path);

  return {
    detail: namespaceName ? `\\${namespaceName}` : getFileName(path),
    id: `${path}:${position.lineNumber}:${position.column}`,
    label,
    path,
    position,
  };
}

export function implementationChooserTitle(
  symbolName: string | null,
): string {
  if (!symbolName) {
    return "Choose implementation";
  }

  return `Choose implementation of ${symbolName}`;
}

function phpNamespaceName(source: string): string | null {
  const match = /\bnamespace\s+([^;{]+)\s*[;{]/.exec(source);

  if (!match?.[1]) {
    return null;
  }

  return match[1].trim().replace(/^\\+/, "");
}

function nearestPhpTypeName(
  source: string,
  position: EditorPosition,
): string | null {
  const lines = source.split(/\r?\n/).slice(0, position.lineNumber);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match =
      /\b(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
        lines[index] ?? "",
      );

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}
