import type * as Monaco from "monaco-editor";
import type {
  LanguageServerDocumentHighlight,
  LanguageServerDocumentSymbol,
  LanguageServerFoldingRange,
  LanguageServerFormattingOptions,
  LanguageServerLinkedEditingRanges,
  LanguageServerRange,
  LanguageServerSelectionRange,
  LanguageServerSemanticTokens,
  LanguageServerTextEdit,
} from "../domain/languageServerFeatures";

type MonacoApi = typeof Monaco;

export function toLanguageServerRange(range: Monaco.Range): LanguageServerRange {
  return {
    end: {
      character: Math.max(0, range.endColumn - 1),
      line: Math.max(0, range.endLineNumber - 1),
    },
    start: {
      character: Math.max(0, range.startColumn - 1),
      line: Math.max(0, range.startLineNumber - 1),
    },
  };
}

export function toLanguageServerFormattingOptions(
  options: Monaco.languages.FormattingOptions,
): LanguageServerFormattingOptions {
  return {
    insertSpaces: options.insertSpaces,
    tabSize: options.tabSize,
  };
}

export function toMonacoRange(monaco: MonacoApi, range: LanguageServerRange): Monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

export function toMonacoTextEdit(
  monaco: MonacoApi,
  edit: LanguageServerTextEdit,
): Monaco.languages.TextEdit {
  return {
    range: toMonacoRange(monaco, edit.range),
    text: edit.newText,
  };
}

export function toMonacoDocumentHighlight(
  monaco: MonacoApi,
  highlight: LanguageServerDocumentHighlight,
): Monaco.languages.DocumentHighlight {
  return {
    kind: monacoDocumentHighlightKind(monaco, highlight.kind),
    range: toMonacoRange(monaco, highlight.range),
  };
}

export function toMonacoDocumentSymbol(
  monaco: MonacoApi,
  symbol: LanguageServerDocumentSymbol,
): Monaco.languages.DocumentSymbol {
  return {
    children: symbol.children.map((child) => toMonacoDocumentSymbol(monaco, child)),
    containerName: symbol.containerName ?? undefined,
    detail: symbol.detail ?? "",
    kind: monacoSymbolKind(monaco, symbol.kind),
    name: symbol.name,
    range: toMonacoRange(monaco, symbol.range),
    selectionRange: toMonacoRange(monaco, symbol.selectionRange),
    tags: symbol.tags?.includes(1) ? [monaco.languages.SymbolTag.Deprecated] : [],
  };
}

export function monacoSymbolKind(monaco: MonacoApi, kind: number): Monaco.languages.SymbolKind {
  const kinds: Record<number, Monaco.languages.SymbolKind> = {
    1: monaco.languages.SymbolKind.File,
    2: monaco.languages.SymbolKind.Module,
    3: monaco.languages.SymbolKind.Namespace,
    4: monaco.languages.SymbolKind.Package,
    5: monaco.languages.SymbolKind.Class,
    6: monaco.languages.SymbolKind.Method,
    7: monaco.languages.SymbolKind.Property,
    8: monaco.languages.SymbolKind.Field,
    9: monaco.languages.SymbolKind.Constructor,
    10: monaco.languages.SymbolKind.Enum,
    11: monaco.languages.SymbolKind.Interface,
    12: monaco.languages.SymbolKind.Function,
    13: monaco.languages.SymbolKind.Variable,
    14: monaco.languages.SymbolKind.Constant,
    15: monaco.languages.SymbolKind.String,
    16: monaco.languages.SymbolKind.Number,
    17: monaco.languages.SymbolKind.Boolean,
    18: monaco.languages.SymbolKind.Array,
    19: monaco.languages.SymbolKind.Object,
    20: monaco.languages.SymbolKind.Key,
    21: monaco.languages.SymbolKind.Null,
    22: monaco.languages.SymbolKind.EnumMember,
    23: monaco.languages.SymbolKind.Struct,
    24: monaco.languages.SymbolKind.Event,
    25: monaco.languages.SymbolKind.Operator,
    26: monaco.languages.SymbolKind.TypeParameter,
  };
  return kinds[kind] ?? monaco.languages.SymbolKind.Variable;
}

export function toMonacoFoldingRange(
  monaco: MonacoApi,
  range: LanguageServerFoldingRange,
): Monaco.languages.FoldingRange {
  return {
    end: range.endLine + 1,
    kind: range.kind ? monaco.languages.FoldingRangeKind.fromValue(range.kind) : undefined,
    start: range.startLine + 1,
  };
}

export function toMonacoLinkedEditingRanges(
  monaco: MonacoApi,
  ranges: LanguageServerLinkedEditingRanges | null,
): Monaco.languages.LinkedEditingRanges | null {
  if (!ranges || ranges.ranges.length === 0) {
    return null;
  }

  return {
    ranges: ranges.ranges.map((range) => toMonacoRange(monaco, range)),
    ...(ranges.wordPattern ? { wordPattern: safeRegExp(ranges.wordPattern) } : {}),
  };
}

export function toMonacoSemanticTokens(
  tokens: LanguageServerSemanticTokens | null,
): Monaco.languages.SemanticTokens | null {
  if (!tokens || tokens.data.length === 0) {
    return null;
  }

  return {
    data: Uint32Array.from(tokens.data),
    ...(tokens.resultId ? { resultId: tokens.resultId } : {}),
  };
}

export function flattenSelectionRange(
  monaco: MonacoApi,
  selectionRange: LanguageServerSelectionRange,
): Monaco.languages.SelectionRange[] {
  const ranges: Monaco.languages.SelectionRange[] = [];
  let current: LanguageServerSelectionRange | null = selectionRange;

  while (current) {
    ranges.push({ range: toMonacoRange(monaco, current.range) });
    current = current.parent;
  }

  return ranges;
}

function monacoDocumentHighlightKind(
  monaco: MonacoApi,
  kind: number | null,
): Monaco.languages.DocumentHighlightKind {
  if (kind === 2) return monaco.languages.DocumentHighlightKind.Read;
  if (kind === 3) return monaco.languages.DocumentHighlightKind.Write;
  return monaco.languages.DocumentHighlightKind.Text;
}

function safeRegExp(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}
