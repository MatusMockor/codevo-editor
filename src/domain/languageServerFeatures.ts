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

export interface LanguageServerCompletionTextEdit {
  insert?: LanguageServerRange | null;
  newText: string;
  range?: LanguageServerRange | null;
  replace?: LanguageServerRange | null;
}

export interface LanguageServerCompletionItemLabelDetails {
  description: string | null;
  detail: string | null;
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
  labelDetails?: LanguageServerCompletionItemLabelDetails | null;
  preselect?: boolean;
  sortText?: string | null;
  textEdit?: LanguageServerCompletionTextEdit | null;
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

export interface LanguageServerDocumentSymbol {
  children: LanguageServerDocumentSymbol[];
  containerName: string | null;
  detail: string | null;
  kind: number;
  name: string;
  range: LanguageServerRange;
  selectionRange: LanguageServerRange;
}

export interface LanguageServerDocumentHighlight {
  kind: number | null;
  range: LanguageServerRange;
}

export interface LanguageServerDocumentLink {
  data?: unknown;
  range: LanguageServerRange;
  target: string | null;
  tooltip: string | null;
}

export interface LanguageServerFoldingRange {
  endCharacter: number | null;
  endLine: number;
  kind: string | null;
  startCharacter: number | null;
  startLine: number;
}

export interface LanguageServerSelectionRange {
  parent: LanguageServerSelectionRange | null;
  range: LanguageServerRange;
}

export interface LanguageServerLinkedEditingRanges {
  ranges: LanguageServerRange[];
  wordPattern: string | null;
}

export interface LanguageServerSemanticTokens {
  data: number[];
  resultId: string | null;
}

export interface LanguageServerWorkspaceSymbol {
  containerName: string | null;
  kind: number;
  location: LanguageServerLocation | null;
  name: string;
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

export interface LanguageServerPrepareRenameResult {
  defaultBehavior: boolean;
  placeholder: string | null;
  range: LanguageServerRange | null;
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
  typeDefinition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
  inlayHints(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
  ): Promise<LanguageServerInlayHint[]>;
  documentSymbols(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerDocumentSymbol[]>;
  documentHighlights(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerDocumentHighlight[]>;
  documentLinks(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerDocumentLink[]>;
  resolveDocumentLink(
    rootPath: string,
    link: LanguageServerDocumentLink,
  ): Promise<LanguageServerDocumentLink>;
  foldingRanges(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerFoldingRange[]>;
  workspaceSymbols(
    rootPath: string,
    query: string,
  ): Promise<LanguageServerWorkspaceSymbol[]>;
  references(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
  selectionRanges(
    rootPath: string,
    path: string,
    positions: LanguageServerPosition[],
  ): Promise<LanguageServerSelectionRange[]>;
  linkedEditingRanges(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLinkedEditingRanges | null>;
  semanticTokens(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerSemanticTokens | null>;
  signatureHelp(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerSignatureHelp | null>;
  prepareRename(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerPrepareRenameResult | null>;
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
  rangeFormatting(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
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
