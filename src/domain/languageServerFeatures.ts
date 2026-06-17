import type { LanguageServerCapabilities } from "./languageServerRuntime";

export type LanguageServerFeature = keyof LanguageServerCapabilities;

export interface EditorPosition {
  lineNumber: number;
  column: number;
}

export interface EditorRevealTarget {
  path: string;
  position: EditorPosition;
}

export interface LanguageServerTextDocumentPosition {
  path: string;
  line: number;
  character: number;
}

export interface LanguageServerHover {
  contents: string;
}

export interface LanguageServerCompletionItem {
  label: string;
  detail: string | null;
  documentation: string | null;
  insertText: string | null;
  kind: number | null;
}

export interface LanguageServerCompletionList {
  isIncomplete: boolean;
  items: LanguageServerCompletionItem[];
}

export interface LanguageServerPosition {
  line: number;
  character: number;
}

export interface LanguageServerRange {
  start: LanguageServerPosition;
  end: LanguageServerPosition;
}

export interface LanguageServerLocation {
  uri: string;
  range: LanguageServerRange;
}

export interface LanguageServerFeaturesGateway {
  hover(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerHover | null>;
  completion(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerCompletionList>;
  definition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
  implementation(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
}

export function canUseLanguageServerFeature(
  capabilities: LanguageServerCapabilities,
  feature: LanguageServerFeature,
): boolean {
  return capabilities[feature];
}

export function toLanguageServerTextDocumentPosition(
  path: string,
  position: EditorPosition,
): LanguageServerTextDocumentPosition {
  return {
    character: Math.max(0, position.column - 1),
    line: Math.max(0, position.lineNumber - 1),
    path,
  };
}

export function toEditorPosition(
  position: LanguageServerPosition,
): EditorPosition {
  return {
    column: position.character + 1,
    lineNumber: position.line + 1,
  };
}

export function pathFromLanguageServerUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);

    if (parsed.protocol !== "file:") {
      return null;
    }

    return decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
}

export function emptyLanguageServerCompletionList(): LanguageServerCompletionList {
  return {
    isIncomplete: false,
    items: [],
  };
}
