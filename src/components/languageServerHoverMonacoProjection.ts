import type * as Monaco from "monaco-editor";
import type {
  LanguageServerHover,
  LanguageServerHoverContent,
  LanguageServerRange,
} from "../domain/languageServerFeatures";

const MAX_HOVER_CONTENT_ITEMS = 32;
const MAX_HOVER_CONTENT_ITEM_BYTES = 16 * 1024;
const MAX_HOVER_CONTENT_TOTAL_BYTES = 64 * 1024;
const MAX_HOVER_LANGUAGE_BYTES = 64;
const utf8Encoder = new TextEncoder();

export function projectLanguageServerHover(
  hover: LanguageServerHover,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): Monaco.languages.Hover | null {
  const contents =
    typeof hover.contents === "string"
      ? projectLegacyHoverContent(hover.contents)
      : projectStructuredHoverContents(hover.contents);
  if (!contents || contents.every((content) => content.value.trim().length === 0)) {
    return null;
  }

  const range =
    hover.range == null
      ? fallbackHoverRange(model, position)
      : projectHoverRange(model, position, hover.range);
  if (!range) {
    return null;
  }
  return { contents, range };
}

function projectLegacyHoverContent(value: string): Monaco.IMarkdownString[] | null {
  if (!validHoverItemBytes(value, null)) {
    return null;
  }
  return [{ value }];
}

function projectStructuredHoverContents(
  contents: readonly LanguageServerHoverContent[],
): Monaco.IMarkdownString[] | null {
  if (contents.length === 0 || contents.length > MAX_HOVER_CONTENT_ITEMS) {
    return null;
  }
  let totalBytes = 0;
  const projected: Monaco.IMarkdownString[] = [];
  for (const content of contents) {
    if (!isValidHoverContent(content)) {
      return null;
    }
    const language = content.language ?? null;
    const itemBytes =
      utf8Encoder.encode(content.value).byteLength +
      (language === null ? 0 : utf8Encoder.encode(language).byteLength);
    totalBytes += itemBytes;
    if (itemBytes > MAX_HOVER_CONTENT_ITEM_BYTES || totalBytes > MAX_HOVER_CONTENT_TOTAL_BYTES) {
      return null;
    }
    projected.push(projectHoverContent(content));
  }
  return projected;
}

function isValidHoverContent(content: LanguageServerHoverContent): boolean {
  if (
    !content ||
    typeof content.value !== "string" ||
    (content.kind !== "code" && content.kind !== "markdown" && content.kind !== "plaintext")
  ) {
    return false;
  }
  if (content.kind !== "code") {
    return content.language == null;
  }
  return (
    typeof content.language === "string" &&
    content.language.length > 0 &&
    utf8Encoder.encode(content.language).byteLength <= MAX_HOVER_LANGUAGE_BYTES
  );
}

function validHoverItemBytes(value: string, language: string | null): boolean {
  const bytes =
    utf8Encoder.encode(value).byteLength +
    (language === null ? 0 : utf8Encoder.encode(language).byteLength);
  return bytes <= MAX_HOVER_CONTENT_ITEM_BYTES && bytes <= MAX_HOVER_CONTENT_TOTAL_BYTES;
}

function projectHoverContent(content: LanguageServerHoverContent): Monaco.IMarkdownString {
  switch (content.kind) {
    case "markdown":
      return safeMarkdown(content.value);
    case "plaintext":
      return safeMarkdown(escapeMarkdownText(content.value));
    case "code":
      return safeMarkdown(fencedCodeBlock(content.language ?? "", content.value));
  }
}

function safeMarkdown(value: string): Monaco.IMarkdownString {
  return {
    isTrusted: false,
    supportHtml: false,
    supportThemeIcons: false,
    value,
  };
}

function escapeMarkdownText(value: string): string {
  return value.replace(/[\\`*_[\]{}()#+\-.!|>~]/g, "\\$&");
}

function fencedCodeBlock(language: string, value: string): string {
  const safeLanguage = /^[A-Za-z0-9_+#.-]{1,64}$/.test(language) ? language : "";
  const longestFence = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}${safeLanguage}\n${value}\n${fence}`;
}

function projectHoverRange(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  range: LanguageServerRange,
): Monaco.IRange | null {
  const { start, end } = range;
  if (
    !validCoordinate(start.line) ||
    !validCoordinate(start.character) ||
    !validCoordinate(end.line) ||
    !validCoordinate(end.character) ||
    start.line > end.line ||
    (start.line === end.line && start.character > end.character)
  ) {
    return null;
  }
  const projected = {
    endColumn: end.character + 1,
    endLineNumber: end.line + 1,
    startColumn: start.character + 1,
    startLineNumber: start.line + 1,
  };
  return model.isValidRange(projected) && rangeContainsPosition(projected, position)
    ? projected
    : null;
}

function fallbackHoverRange(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): Monaco.IRange | null {
  const range = {
    endColumn: position.column,
    endLineNumber: position.lineNumber,
    startColumn: position.column,
    startLineNumber: position.lineNumber,
  };
  return model.isValidRange(range) ? range : null;
}

function rangeContainsPosition(range: Monaco.IRange, position: Monaco.Position): boolean {
  const afterStart =
    position.lineNumber > range.startLineNumber ||
    (position.lineNumber === range.startLineNumber && position.column >= range.startColumn);
  const beforeEnd =
    position.lineNumber < range.endLineNumber ||
    (position.lineNumber === range.endLineNumber && position.column < range.endColumn);
  return afterStart && beforeEnd;
}

function validCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
