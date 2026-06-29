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
  command?: LanguageServerCodeActionCommand | null;
  data?: unknown;
  deprecated?: boolean;
  label: string;
  detail: string | null;
  documentation: string | null;
  documentationKind?: "markdown" | "plaintext" | string | null;
  filterText?: string | null;
  insertText: string | null;
  insertTextFormat?: number | null;
  insertTextMode?: number | null;
  kind: number | null;
  labelDetails?: LanguageServerCompletionItemLabelDetails | null;
  preselect?: boolean;
  sortText?: string | null;
  tags?: number[];
  textEdit?: LanguageServerCompletionTextEdit | null;
  textEditText?: string | null;
}

export interface LanguageServerCompletionList {
  isIncomplete: boolean;
  items: LanguageServerCompletionItem[];
}

export type LanguageServerCompletionTriggerKind = 1 | 2 | 3;

export interface LanguageServerCompletionContext {
  triggerCharacter: string | null;
  triggerKind: LanguageServerCompletionTriggerKind;
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

export interface LanguageServerWorkspaceFileOperationOptions {
  ignoreIfExists?: boolean;
  ignoreIfNotExists?: boolean;
  overwrite?: boolean;
  recursive?: boolean;
}

export type LanguageServerWorkspaceFileOperation =
  | {
      kind: "create";
      options?: LanguageServerWorkspaceFileOperationOptions | null;
      uri: string;
    }
  | {
      kind: "rename";
      newUri: string;
      oldUri: string;
      options?: LanguageServerWorkspaceFileOperationOptions | null;
    }
  | {
      kind: "delete";
      options?: LanguageServerWorkspaceFileOperationOptions | null;
      uri: string;
    };

export interface LanguageServerInlayHintLabelPart {
  command?: LanguageServerCodeActionCommand | null;
  label: string;
  location?: LanguageServerLocation | null;
  tooltip?: string | null;
}

export type LanguageServerInlayHintLabel =
  | string
  | LanguageServerInlayHintLabelPart[];

export interface LanguageServerInlayHint {
  data?: unknown;
  kind: number | null;
  label: LanguageServerInlayHintLabel;
  paddingLeft: boolean;
  paddingRight: boolean;
  position: LanguageServerPosition;
  textEdits?: LanguageServerTextEdit[];
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
  tags?: number[];
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

export type LanguageServerSignatureHelpTriggerKind = 1 | 2 | 3;

export interface LanguageServerSignatureHelpContext {
  activeSignatureHelp?: LanguageServerSignatureHelp | null;
  isRetrigger: boolean;
  triggerCharacter?: string | null;
  triggerKind: LanguageServerSignatureHelpTriggerKind;
}

export interface LanguageServerWorkspaceEdit {
  changes: Record<string, LanguageServerTextEdit[]>;
  documentVersions?: Record<string, number | null>;
  fileOperations?: LanguageServerWorkspaceFileOperation[];
}

export type LanguageServerWorkspaceFileChangeType =
  | "created"
  | "changed"
  | "deleted";

export interface LanguageServerWorkspaceFileChange {
  path: string;
  changeType: LanguageServerWorkspaceFileChangeType;
}

export type LanguageServerConfigurationSettings = Record<string, unknown>;

export interface LanguageServerPrepareRenameResult {
  defaultBehavior: boolean;
  placeholder: string | null;
  range: LanguageServerRange | null;
}

export interface LanguageServerWorkspaceEditEvent {
  edit: LanguageServerWorkspaceEdit;
  label: string | null;
  rootPath: string;
  sessionId: number;
}

export type LanguageServerWorkspaceEditUnsubscribeFn = () => void;

export interface LanguageServerWorkspaceEditGateway {
  subscribeWorkspaceEdits(
    listener: (event: LanguageServerWorkspaceEditEvent) => void,
  ): Promise<LanguageServerWorkspaceEditUnsubscribeFn>;
}

export type LanguageServerRefreshFeature =
  | "codeLens"
  | "inlayHint"
  | "semanticTokens";

export interface LanguageServerRefreshEvent {
  feature: LanguageServerRefreshFeature;
  rootPath: string;
  sessionId: number;
}

export type LanguageServerRefreshUnsubscribeFn = () => void;

export interface LanguageServerRefreshGateway {
  subscribeRefreshEvents(
    listener: (event: LanguageServerRefreshEvent) => void,
  ): Promise<LanguageServerRefreshUnsubscribeFn>;
}

export interface LanguageServerCodeActionCommand {
  arguments: unknown[] | null;
  command: string;
  title: string;
}

export interface LanguageServerCodeActionDiagnostic {
  code?: string | number | null;
  data?: unknown | null;
  message: string;
  range: LanguageServerRange;
  severity: number | null;
  source: string | null;
}

export interface LanguageServerCodeActionContext {
  diagnostics: LanguageServerCodeActionDiagnostic[];
  only: string[] | null;
  triggerKind?: number | null;
}

export interface LanguageServerCodeAction {
  command: LanguageServerCodeActionCommand | null;
  data: unknown | null;
  disabled?: { reason: string } | null;
  edit: LanguageServerWorkspaceEdit | null;
  isPreferred: boolean;
  kind: string | null;
  title: string;
}

export interface LanguageServerCodeLens {
  command: LanguageServerCodeActionCommand | null;
  data: unknown | null;
  range: LanguageServerRange;
}

export interface LanguageServerCallHierarchyItem {
  data?: unknown;
  detail: string | null;
  kind: number;
  name: string;
  range: LanguageServerRange;
  selectionRange: LanguageServerRange;
  tags?: number[];
  uri: string;
}

export interface LanguageServerIncomingCall {
  from: LanguageServerCallHierarchyItem;
  fromRanges: LanguageServerRange[];
}

export interface LanguageServerOutgoingCall {
  fromRanges: LanguageServerRange[];
  to: LanguageServerCallHierarchyItem;
}

export interface LanguageServerTypeHierarchyItem {
  data?: unknown;
  detail: string | null;
  kind: number;
  name: string;
  range: LanguageServerRange;
  selectionRange: LanguageServerRange;
  tags?: number[];
  uri: string;
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
    context?: LanguageServerCompletionContext,
  ): Promise<LanguageServerCompletionList>;
  resolveCompletionItem(
    rootPath: string,
    item: LanguageServerCompletionItem,
  ): Promise<LanguageServerCompletionItem>;
  definition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
  sourceDefinition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]>;
  declaration(
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
  resolveInlayHint(
    rootPath: string,
    hint: LanguageServerInlayHint,
  ): Promise<LanguageServerInlayHint>;
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
  rangeSemanticTokens(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
  ): Promise<LanguageServerSemanticTokens | null>;
  signatureHelp(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    context?: LanguageServerSignatureHelpContext,
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
  codeLenses(rootPath: string, path: string): Promise<LanguageServerCodeLens[]>;
  resolveCodeLens(
    rootPath: string,
    lens: LanguageServerCodeLens,
  ): Promise<LanguageServerCodeLens>;
  prepareCallHierarchy(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerCallHierarchyItem[]>;
  incomingCalls(
    rootPath: string,
    item: LanguageServerCallHierarchyItem,
  ): Promise<LanguageServerIncomingCall[]>;
  outgoingCalls(
    rootPath: string,
    item: LanguageServerCallHierarchyItem,
  ): Promise<LanguageServerOutgoingCall[]>;
  prepareTypeHierarchy(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerTypeHierarchyItem[]>;
  typeHierarchySupertypes(
    rootPath: string,
    item: LanguageServerTypeHierarchyItem,
  ): Promise<LanguageServerTypeHierarchyItem[]>;
  typeHierarchySubtypes(
    rootPath: string,
    item: LanguageServerTypeHierarchyItem,
  ): Promise<LanguageServerTypeHierarchyItem[]>;
  executeCommand(
    rootPath: string,
    command: LanguageServerCodeActionCommand,
  ): Promise<LanguageServerWorkspaceEdit | null>;
  executeCommandLocations(
    rootPath: string,
    command: LanguageServerCodeActionCommand,
  ): Promise<LanguageServerLocation[]>;
  willCreateFiles(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerWorkspaceEdit | null>;
  didCreateFiles(rootPath: string, path: string): Promise<void>;
  willRenameFiles(
    rootPath: string,
    oldPath: string,
    newPath: string,
  ): Promise<LanguageServerWorkspaceEdit | null>;
  didRenameFiles(
    rootPath: string,
    oldPath: string,
    newPath: string,
  ): Promise<void>;
  willDeleteFiles(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerWorkspaceEdit | null>;
  didDeleteFiles(rootPath: string, path: string): Promise<void>;
  didChangeWatchedFiles(
    rootPath: string,
    changes: LanguageServerWorkspaceFileChange[],
  ): Promise<void>;
  didChangeConfiguration(
    rootPath: string,
    settings: LanguageServerConfigurationSettings,
  ): Promise<void>;
  formatting(
    rootPath: string,
    path: string,
    options: LanguageServerFormattingOptions,
  ): Promise<LanguageServerTextEdit[]>;
  onTypeFormatting(
    rootPath: string,
    path: string,
    position: LanguageServerPosition,
    ch: string,
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
  return capabilities[feature] === true;
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
