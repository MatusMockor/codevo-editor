import type {
  EditorPosition,
  LanguageServerLocation,
} from "./languageServerFeatures";
import {
  pathFromLanguageServerUri,
  toEditorPosition,
} from "./languageServerFeatures";
import type { ProjectSymbolSearchResult } from "./projectSymbols";
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

export function implementationTargetFromProjectSymbol(
  symbol: ProjectSymbolSearchResult,
): ImplementationTarget {
  const position = {
    column: Math.max(1, Number(symbol.column)),
    lineNumber: Math.max(1, Number(symbol.lineNumber)),
  };
  const containerName =
    symbol.containerName ??
    containerNameFromFullyQualifiedSymbolName(
      symbol.fullyQualifiedName,
      symbol.name,
    );
  const namespace = containerName?.includes("\\")
    ? containerName.split("\\").slice(0, -1).join("\\")
    : "";

  return {
    detail: namespace
      ? `\\${namespace}`
      : symbol.relativePath || getFileName(symbol.path),
    id: `${symbol.path}:${position.lineNumber}:${position.column}`,
    label: containerName ? shortPhpName(containerName) : getFileName(symbol.path),
    path: symbol.path,
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

function containerNameFromFullyQualifiedSymbolName(
  fullyQualifiedName: string,
  symbolName: string,
): string | null {
  const suffixes = [`::${symbolName}`, `.${symbolName}`];

  for (const suffix of suffixes) {
    if (
      fullyQualifiedName.toLowerCase().endsWith(suffix.toLowerCase()) &&
      fullyQualifiedName.length > suffix.length
    ) {
      return fullyQualifiedName.slice(0, -suffix.length);
    }
  }

  return null;
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}
