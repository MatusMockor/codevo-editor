import type {
  EditorPosition,
  LanguageServerDocumentSymbol,
} from "./languageServerFeatures";

/**
 * Determines whether the 1-based editor cursor falls inside a document
 * symbol whose range is expressed with 0-based LSP coordinates.
 */
export function symbolContainsCursorPosition(
  symbol: LanguageServerDocumentSymbol,
  cursor: EditorPosition,
): boolean {
  const cursorLine = cursor.lineNumber - 1;
  const cursorCharacter = cursor.column - 1;
  const { start, end } = symbol.range;

  if (cursorLine < start.line || cursorLine > end.line) {
    return false;
  }

  if (cursorLine === start.line && cursorCharacter < start.character) {
    return false;
  }

  if (cursorLine === end.line && cursorCharacter > end.character) {
    return false;
  }

  return true;
}

/**
 * Builds the breadcrumb path from the document symbol tree down to the
 * deepest symbol containing the cursor. Returns an empty array when the
 * cursor sits outside every symbol.
 */
export function breadcrumbPathFromCursorAndSymbols(
  cursor: EditorPosition,
  symbols: LanguageServerDocumentSymbol[],
): LanguageServerDocumentSymbol[] {
  const containing = symbols.find((symbol) =>
    symbolContainsCursorPosition(symbol, cursor),
  );

  if (!containing) {
    return [];
  }

  return [
    containing,
    ...breadcrumbPathFromCursorAndSymbols(cursor, containing.children),
  ];
}

export function breadcrumbSiblingsAt(
  symbols: LanguageServerDocumentSymbol[],
  path: LanguageServerDocumentSymbol[],
  index: number,
): LanguageServerDocumentSymbol[] {
  if (!Number.isInteger(index) || index < 0 || index >= path.length) {
    return [];
  }

  let siblings = symbols;

  for (let pathIndex = 0; pathIndex < index; pathIndex += 1) {
    const parent = path[pathIndex];

    if (!parent || !siblings.includes(parent)) {
      return [];
    }

    siblings = parent.children;
  }

  if (!siblings.includes(path[index])) {
    return [];
  }

  return siblings;
}
