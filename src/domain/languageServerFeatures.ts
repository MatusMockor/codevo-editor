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
  additionalTextEdits?: LanguageServerTextEdit[];
  commitCharacters?: string[];
  data?: unknown;
  label: string;
  detail: string | null;
  documentation: string | null;
  filterText?: string | null;
  insertText: string | null;
  insertTextFormat?: number | null;
  kind: number | null;
  sortText?: string | null;
  textEdit?: LanguageServerTextEdit | null;
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

export interface LanguageServerTextEdit {
  range: LanguageServerRange;
  newText: string;
}

export interface LanguageServerInlayHint {
  kind: number | null;
  label: string;
  paddingLeft: boolean;
  paddingRight: boolean;
  position: LanguageServerPosition;
  tooltip: string | null;
}

export interface LanguageServerSignatureParameter {
  documentation: string | null;
  label: string;
}

export interface LanguageServerSignature {
  documentation: string | null;
  label: string;
  parameters: LanguageServerSignatureParameter[];
}

export interface LanguageServerSignatureHelp {
  activeParameter: number;
  activeSignature: number;
  signatures: LanguageServerSignature[];
}

export interface LanguageServerWorkspaceEdit {
  changes: Record<string, LanguageServerTextEdit[]>;
}

export interface LanguageServerWorkspaceEditEvent {
  edit: LanguageServerWorkspaceEdit;
  label: string | null;
  rootPath?: string;
  sessionId: number;
}

export type LanguageServerWorkspaceEditUnsubscribeFn = () => void;

export interface LanguageServerWorkspaceEditGateway {
  subscribeWorkspaceEdits(
    listener: (event: LanguageServerWorkspaceEditEvent) => void,
  ): Promise<LanguageServerWorkspaceEditUnsubscribeFn>;
}

export interface LanguageServerCodeActionCommand {
  arguments: unknown[] | null;
  command: string;
  title: string;
}

export interface LanguageServerCodeActionDiagnostic {
  code?: string | number | null;
  message: string;
  range: LanguageServerRange;
  severity: number | null;
  source: string | null;
}

export interface LanguageServerCodeActionContext {
  diagnostics: LanguageServerCodeActionDiagnostic[];
  only: string[] | null;
}

export interface LanguageServerCodeAction {
  command: LanguageServerCodeActionCommand | null;
  data: unknown | null;
  edit: LanguageServerWorkspaceEdit | null;
  isPreferred: boolean;
  kind: string | null;
  title: string;
}

export interface LanguageServerFormattingOptions {
  insertSpaces: boolean;
  tabSize: number;
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
  resolveCompletionItem(
    rootPath: string,
    item: LanguageServerCompletionItem,
  ): Promise<LanguageServerCompletionItem>;
  definition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
  implementation(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
  inlayHints(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
  ): Promise<LanguageServerInlayHint[]>;
  references(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
  signatureHelp(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerSignatureHelp | null>;
  rename(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    newName: string,
  ): Promise<LanguageServerWorkspaceEdit | null>;
  codeActions(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
  ): Promise<LanguageServerCodeAction[]>;
  resolveCodeAction(
    rootPath: string,
    action: LanguageServerCodeAction,
  ): Promise<LanguageServerCodeAction>;
  executeCommand(
    rootPath: string,
    command: LanguageServerCodeActionCommand,
  ): Promise<LanguageServerWorkspaceEdit | null>;
  formatting(
    rootPath: string,
    path: string,
    options: LanguageServerFormattingOptions,
  ): Promise<LanguageServerTextEdit[]>;
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
