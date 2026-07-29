import { createElement } from "react";
import type * as Monaco from "monaco-editor";
import type { Breakpoint } from "../../domain/debug";
import type { LanguageServerDocumentSymbol } from "../../domain/languageServerFeatures";
import type { UserSnippet } from "../../domain/snippets";
import type { MonacoAppTheme } from "../../domain/settings";
import {
  applyImmediateFallbackTheme,
  configureShikiLanguageFeatures,
  setupShikiTokenization,
} from "../../infrastructure/shikiHighlighter";
import { setupEmmet } from "../../infrastructure/emmetSetup";

export const EMPTY_PATHS: readonly string[] = Object.freeze([]);
export const EMPTY_BOOKMARK_LINES: readonly number[] = Object.freeze([]);
export const EMPTY_BREAKPOINTS: readonly Breakpoint[] = Object.freeze([]);
export const EMPTY_USER_SNIPPETS: readonly UserSnippet[] = Object.freeze([]);
export const noopLocalPhpDiagnosticsChange = () => undefined;
export const EMPTY_BREADCRUMB_SYMBOLS: LanguageServerDocumentSymbol[] = [];
export const EMPTY_BREADCRUMB_PATH: LanguageServerDocumentSymbol[] = [];
export const PLACEHOLDER_PATH = "inmemory://workbench/empty";
export const PLACEHOLDER_LANGUAGE = "plaintext";

function EditorLoadingPlaceholder() {
  return createElement("div", {
    "aria-hidden": true,
    className: "editor-loading-placeholder",
  });
}

export const EDITOR_LOADING_PLACEHOLDER = createElement(EditorLoadingPlaceholder);

export function beforeMonacoMount(monaco: typeof Monaco, theme: MonacoAppTheme): void {
  applyImmediateFallbackTheme(monaco, theme);
  configureShikiLanguageFeatures(monaco);
  setupEmmet(monaco);
  setupShikiTokenization(monaco, theme).catch((error: unknown) => {
    console.error("Shiki tokenization setup failed", error);
  });
}
