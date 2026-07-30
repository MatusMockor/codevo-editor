import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyLanguageServerCompletionList,
  type BoundedLanguageServerLocations,
  type IdentifiedLanguageServerRequest,
  type IdentifiedLanguageServerRequestsPort,
  type JavaScriptTypeScriptLanguageServerFeaturesGateway,
  type LanguageServerCallHierarchyItem,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeActionContext,
  type LanguageServerConfigurationSettings,
  type LanguageServerCompletionContext,
  type LanguageServerCodeLens,
  type LanguageServerCompletionItem,
  type LanguageServerCompletionList,
  type LanguageServerDocumentHighlight,
  type LanguageServerDocumentLink,
  type LanguageServerDocumentSymbol,
  type LanguageServerFoldingRange,
  type LanguageServerFormattingOptions,
  type LanguageServerHover,
  type LanguageServerIncomingCall,
  type LanguageServerInlayHint,
  type LanguageServerLinkedEditingRanges,
  type LanguageServerLocation,
  type LanguageServerLocationList,
  type LanguageServerOutgoingCall,
  type LanguageServerPosition,
  type LanguageServerPrepareRenameResult,
  type LanguageServerRange,
  type LanguageServerSelectionRange,
  type LanguageServerSemanticTokens,
  type LanguageServerSignatureHelp,
  type LanguageServerSignatureHelpContext,
  type LanguageServerTextEdit,
  type LanguageServerTextDocumentPosition,
  type LanguageServerTypeHierarchyItem,
  type LanguageServerWorkspaceFileChange,
  type LanguageServerWorkspaceSymbol,
  type LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type RuntimeDetector = () => boolean;
export type LanguageServerRequestServerKind = "php" | "javascriptTypeScript";

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);
const allocateRequestId = createMonotonicLanguageServerRequestIdAllocator();
const DEFAULT_FEATURE_COMMANDS = {
  codeActionResolve: "text_document_code_action_resolve",
  codeActions: "text_document_code_actions",
  codeLensResolve: "text_document_code_lens_resolve",
  codeLenses: "text_document_code_lenses",
  completion: "text_document_completion",
  completionResolve: "text_document_completion_resolve",
  declaration: "text_document_declaration",
  definition: "text_document_definition",
  sourceDefinition: "text_document_definition",
  didChangeConfiguration: "workspace_did_change_configuration",
  didChangeWatchedFiles: "workspace_did_change_watched_files",
  didCreateFiles: "workspace_did_create_files",
  didDeleteFiles: "workspace_did_delete_files",
  didRenameFiles: "workspace_did_rename_files",
  typeDefinition: "text_document_type_definition",
  documentHighlights: "text_document_document_highlights",
  documentLinkResolve: "text_document_document_link_resolve",
  documentLinks: "text_document_document_links",
  documentSymbols: "text_document_document_symbols",
  executeCommand: "language_server_execute_command",
  executeCommandLocations: "language_server_execute_command_locations",
  foldingRanges: "text_document_folding_ranges",
  formatting: "text_document_formatting",
  hover: "text_document_hover",
  incomingCalls: "text_document_incoming_calls",
  implementation: "text_document_implementation",
  inlayHintResolve: "text_document_inlay_hint_resolve",
  inlayHints: "text_document_inlay_hints",
  linkedEditingRanges: "text_document_linked_editing_ranges",
  onTypeFormatting: "text_document_on_type_formatting",
  outgoingCalls: "text_document_outgoing_calls",
  prepareCallHierarchy: "text_document_prepare_call_hierarchy",
  prepareRename: "text_document_prepare_rename",
  prepareTypeHierarchy: "text_document_prepare_type_hierarchy",
  rangeFormatting: "text_document_range_formatting",
  references: "text_document_references",
  rename: "text_document_rename",
  selectionRanges: "text_document_selection_ranges",
  rangeSemanticTokens: "text_document_range_semantic_tokens",
  semanticTokens: "text_document_semantic_tokens",
  signatureHelp: "text_document_signature_help",
  typeHierarchySubtypes: "text_document_type_hierarchy_subtypes",
  typeHierarchySupertypes: "text_document_type_hierarchy_supertypes",
  willCreateFiles: "text_document_will_create_files",
  willDeleteFiles: "text_document_will_delete_files",
  willRenameFiles: "text_document_will_rename_files",
  workspaceSymbols: "workspace_symbols",
};

export const JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS = {
  codeActionResolve: "javascript_typescript_text_document_code_action_resolve",
  codeActions: "javascript_typescript_text_document_code_actions",
  codeLensResolve: "javascript_typescript_text_document_code_lens_resolve",
  codeLenses: "javascript_typescript_text_document_code_lenses",
  completion: "javascript_typescript_text_document_completion",
  completionResolve: "javascript_typescript_text_document_completion_resolve",
  declaration: "javascript_typescript_text_document_declaration",
  definition: "javascript_typescript_text_document_definition",
  sourceDefinition: "javascript_typescript_text_document_source_definition",
  didChangeConfiguration: "javascript_typescript_workspace_did_change_configuration",
  didChangeWatchedFiles: "javascript_typescript_workspace_did_change_watched_files",
  didCreateFiles: "javascript_typescript_workspace_did_create_files",
  didDeleteFiles: "javascript_typescript_workspace_did_delete_files",
  didRenameFiles: "javascript_typescript_workspace_did_rename_files",
  typeDefinition: "javascript_typescript_text_document_type_definition",
  documentHighlights: "javascript_typescript_text_document_document_highlights",
  documentLinkResolve: "javascript_typescript_text_document_document_link_resolve",
  documentLinks: "javascript_typescript_text_document_document_links",
  documentSymbols: "javascript_typescript_text_document_document_symbols",
  executeCommand: "javascript_typescript_language_server_execute_command",
  executeCommandLocations: "javascript_typescript_language_server_execute_command_locations",
  foldingRanges: "javascript_typescript_text_document_folding_ranges",
  formatting: "javascript_typescript_text_document_formatting",
  hover: "javascript_typescript_text_document_hover",
  incomingCalls: "javascript_typescript_text_document_incoming_calls",
  implementation: "javascript_typescript_text_document_implementation",
  inlayHintResolve: "javascript_typescript_text_document_inlay_hint_resolve",
  inlayHints: "javascript_typescript_text_document_inlay_hints",
  linkedEditingRanges: "javascript_typescript_text_document_linked_editing_ranges",
  onTypeFormatting: "javascript_typescript_text_document_on_type_formatting",
  outgoingCalls: "javascript_typescript_text_document_outgoing_calls",
  prepareCallHierarchy: "javascript_typescript_text_document_prepare_call_hierarchy",
  prepareRename: "javascript_typescript_text_document_prepare_rename",
  prepareTypeHierarchy: "javascript_typescript_text_document_prepare_type_hierarchy",
  rangeFormatting: "javascript_typescript_text_document_range_formatting",
  references: "javascript_typescript_text_document_references",
  rename: "javascript_typescript_text_document_rename",
  selectionRanges: "javascript_typescript_text_document_selection_ranges",
  rangeSemanticTokens: "javascript_typescript_text_document_range_semantic_tokens",
  semanticTokens: "javascript_typescript_text_document_semantic_tokens",
  signatureHelp: "javascript_typescript_text_document_signature_help",
  typeHierarchySubtypes: "javascript_typescript_text_document_type_hierarchy_subtypes",
  typeHierarchySupertypes: "javascript_typescript_text_document_type_hierarchy_supertypes",
  willCreateFiles: "javascript_typescript_workspace_will_create_files",
  willDeleteFiles: "javascript_typescript_workspace_will_delete_files",
  willRenameFiles: "javascript_typescript_workspace_will_rename_files",
  workspaceSymbols: "javascript_typescript_workspace_symbols",
};

export interface TauriLanguageServerFeatureCommands {
  codeActionResolve: string;
  codeActions: string;
  codeLensResolve: string;
  codeLenses: string;
  completion: string;
  completionResolve: string;
  declaration: string;
  definition: string;
  sourceDefinition: string;
  didChangeConfiguration: string;
  didChangeWatchedFiles: string;
  didCreateFiles: string;
  didDeleteFiles: string;
  didRenameFiles: string;
  typeDefinition: string;
  documentHighlights: string;
  documentLinkResolve: string;
  documentLinks: string;
  documentSymbols: string;
  executeCommand: string;
  executeCommandLocations: string;
  foldingRanges: string;
  formatting: string;
  hover: string;
  incomingCalls: string;
  implementation: string;
  inlayHintResolve: string;
  inlayHints: string;
  linkedEditingRanges: string;
  onTypeFormatting: string;
  outgoingCalls: string;
  prepareCallHierarchy: string;
  prepareRename: string;
  prepareTypeHierarchy: string;
  rangeFormatting: string;
  references: string;
  rename: string;
  selectionRanges: string;
  rangeSemanticTokens: string;
  semanticTokens: string;
  signatureHelp: string;
  typeHierarchySubtypes: string;
  typeHierarchySupertypes: string;
  willCreateFiles: string;
  willDeleteFiles: string;
  willRenameFiles: string;
  workspaceSymbols: string;
}

export class TauriLanguageServerFeaturesGateway implements JavaScriptTypeScriptLanguageServerFeaturesGateway {
  readonly identifiedRequests: IdentifiedLanguageServerRequestsPort = {
    cancelRequest: (rootPath, sessionId, requestId) =>
      this.cancelRequest(rootPath, sessionId, requestId),
    completion: (rootPath, position, context, sessionId) =>
      this.completion(rootPath, position, context, sessionId),
    resolveCompletionItem: (rootPath, item, sessionId) =>
      this.resolveCompletionItem(rootPath, item, sessionId),
    formatting: (rootPath, path, options, sessionId) =>
      this.formatting(rootPath, path, options, sessionId),
    declaration: (rootPath, position, sessionId) => this.declaration(rootPath, position, sessionId),
    definition: (rootPath, position, sessionId) => this.definition(rootPath, position, sessionId),
    hover: (rootPath, position, sessionId) => this.hover(rootPath, position, sessionId),
    implementation: (rootPath, position, sessionId) =>
      this.implementation(rootPath, position, sessionId),
    references: (rootPath, position, sessionId) => this.references(rootPath, position, sessionId),
    prepareRename: (rootPath, position, sessionId) =>
      this.prepareRename(rootPath, position, sessionId),
    rename: (rootPath, position, newName, sessionId) =>
      this.rename(rootPath, position, newName, sessionId),
    signatureHelp: (rootPath, position, context, sessionId) =>
      this.signatureHelp(rootPath, position, context, sessionId),
    sourceDefinition: (rootPath, position, sessionId) =>
      this.sourceDefinition(rootPath, position, sessionId),
    typeDefinition: (rootPath, position, sessionId) =>
      this.typeDefinition(rootPath, position, sessionId),
  };

  constructor(
    private readonly invokeFeatureCommand: InvokeCommand = invokeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly commands: TauriLanguageServerFeatureCommands = DEFAULT_FEATURE_COMMANDS,
    private readonly requestServerKind: LanguageServerRequestServerKind = "php",
  ) {}

  cancelRequest(rootPath: string, sessionId: number, requestId: number): Promise<void> {
    if (!isAuthorityId(sessionId) || !isAuthorityId(requestId)) {
      return Promise.reject(
        new TypeError("Language-server cancellation requires positive safe integer identifiers."),
      );
    }

    return this.invokeWhenAvailable(
      "cancel_lsp_request",
      {
        requestId,
        rootPath,
        serverKind: this.requestServerKind,
        sessionId,
      },
      undefined,
    );
  }

  hover(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerHover | null> {
    return this.invokeFeatureRequest(this.commands.hover, { position, rootPath }, null, sessionId);
  }

  completion(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    context?: LanguageServerCompletionContext,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerCompletionList> {
    return this.invokeFeatureRequest(
      this.commands.completion,
      { ...(context ? { context } : {}), position, rootPath },
      emptyLanguageServerCompletionList(),
      sessionId,
    );
  }

  resolveCompletionItem(
    rootPath: string,
    item: LanguageServerCompletionItem,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerCompletionItem> {
    return this.invokeFeatureRequest(
      this.commands.completionResolve,
      { item, rootPath },
      item,
      sessionId,
    );
  }

  definition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLocation[]> {
    return this.invokeFeatureRequest(
      this.commands.definition,
      { position, rootPath },
      [],
      sessionId,
    );
  }

  sourceDefinition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLocation[]> {
    return this.invokeFeatureRequest(
      this.commands.sourceDefinition,
      { position, rootPath },
      [],
      sessionId,
    );
  }

  declaration(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLocation[]> {
    return this.invokeFeatureRequest(
      this.commands.declaration,
      { position, rootPath },
      [],
      sessionId,
    );
  }

  implementation(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLocation[]> {
    return this.invokeFeatureRequest(
      this.commands.implementation,
      { position, rootPath },
      [],
      sessionId,
    );
  }

  typeDefinition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLocation[]> {
    return this.invokeFeatureRequest(
      this.commands.typeDefinition,
      { position, rootPath },
      [],
      sessionId,
    );
  }

  inlayHints(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
  ): Promise<LanguageServerInlayHint[]> {
    return this.invokeWhenAvailable(this.commands.inlayHints, { path, range, rootPath }, []);
  }

  resolveInlayHint(
    rootPath: string,
    hint: LanguageServerInlayHint,
  ): Promise<LanguageServerInlayHint> {
    return this.invokeWhenAvailable(this.commands.inlayHintResolve, { hint, rootPath }, hint);
  }

  documentSymbols(rootPath: string, path: string): Promise<LanguageServerDocumentSymbol[]> {
    return this.invokeWhenAvailable(this.commands.documentSymbols, { path, rootPath }, []);
  }

  documentHighlights(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerDocumentHighlight[]> {
    return this.invokeFeatureRequest(
      this.commands.documentHighlights,
      { position, rootPath },
      [],
      sessionId,
    );
  }

  documentLinks(rootPath: string, path: string): Promise<LanguageServerDocumentLink[]> {
    return this.invokeWhenAvailable(this.commands.documentLinks, { path, rootPath }, []);
  }

  resolveDocumentLink(
    rootPath: string,
    link: LanguageServerDocumentLink,
  ): Promise<LanguageServerDocumentLink> {
    return this.invokeWhenAvailable(this.commands.documentLinkResolve, { link, rootPath }, link);
  }

  foldingRanges(rootPath: string, path: string): Promise<LanguageServerFoldingRange[]> {
    return this.invokeWhenAvailable(this.commands.foldingRanges, { path, rootPath }, []);
  }

  workspaceSymbols(
    rootPath: string,
    query: string,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerWorkspaceSymbol[]> {
    return this.invokeFeatureRequest(
      this.commands.workspaceSymbols,
      { query, rootPath },
      [],
      sessionId,
    );
  }

  references(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLocationList> {
    return this.invokeBoundedLocationsRequest(
      this.commands.references,
      { position, rootPath },
      sessionId,
    );
  }

  selectionRanges(
    rootPath: string,
    path: string,
    positions: LanguageServerPosition[],
  ): Promise<LanguageServerSelectionRange[]> {
    return this.invokeWhenAvailable(
      this.commands.selectionRanges,
      { path, positions, rootPath },
      [],
    );
  }

  linkedEditingRanges(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLinkedEditingRanges | null> {
    return this.invokeFeatureRequest(
      this.commands.linkedEditingRanges,
      { position, rootPath },
      null,
      sessionId,
    );
  }

  semanticTokens(
    rootPath: string,
    path: string,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerSemanticTokens | null> {
    return this.invokeFeatureRequest(
      this.commands.semanticTokens,
      { path, rootPath },
      null,
      sessionId,
    );
  }

  rangeSemanticTokens(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerSemanticTokens | null> {
    return this.invokeFeatureRequest(
      this.commands.rangeSemanticTokens,
      { path, range, rootPath },
      null,
      sessionId,
    );
  }

  signatureHelp(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    context?: LanguageServerSignatureHelpContext,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerSignatureHelp | null> {
    return this.invokeFeatureRequest(
      this.commands.signatureHelp,
      {
        ...(context ? { context } : {}),
        position,
        rootPath,
      },
      null,
      sessionId,
    );
  }

  prepareRename(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerPrepareRenameResult | null> {
    return this.invokeFeatureRequest(
      this.commands.prepareRename,
      { position, rootPath },
      null,
      sessionId,
    );
  }

  rename(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    newName: string,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerWorkspaceEdit | null> {
    return this.invokeFeatureRequest(
      this.commands.rename,
      { newName, position, rootPath },
      null,
      sessionId,
    );
  }

  codeActions(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerCodeAction[]> {
    return this.invokeFeatureRequest(
      this.commands.codeActions,
      { context, path, range, rootPath },
      [],
      sessionId,
    );
  }

  resolveCodeAction(
    rootPath: string,
    action: LanguageServerCodeAction,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerCodeAction> {
    return this.invokeFeatureRequest(
      this.commands.codeActionResolve,
      { action, rootPath },
      action,
      sessionId,
    );
  }

  codeLenses(rootPath: string, path: string): Promise<LanguageServerCodeLens[]> {
    return this.invokeWhenAvailable(this.commands.codeLenses, { path, rootPath }, []);
  }

  resolveCodeLens(rootPath: string, lens: LanguageServerCodeLens): Promise<LanguageServerCodeLens> {
    return this.invokeWhenAvailable(this.commands.codeLensResolve, { lens, rootPath }, lens);
  }

  prepareCallHierarchy(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerCallHierarchyItem[]> {
    return this.invokeWhenAvailable(this.commands.prepareCallHierarchy, { position, rootPath }, []);
  }

  incomingCalls(
    rootPath: string,
    item: LanguageServerCallHierarchyItem,
  ): Promise<LanguageServerIncomingCall[]> {
    return this.invokeWhenAvailable(this.commands.incomingCalls, { item, rootPath }, []);
  }

  outgoingCalls(
    rootPath: string,
    item: LanguageServerCallHierarchyItem,
  ): Promise<LanguageServerOutgoingCall[]> {
    return this.invokeWhenAvailable(this.commands.outgoingCalls, { item, rootPath }, []);
  }

  prepareTypeHierarchy(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerTypeHierarchyItem[]> {
    return this.invokeWhenAvailable(this.commands.prepareTypeHierarchy, { position, rootPath }, []);
  }

  typeHierarchySupertypes(
    rootPath: string,
    item: LanguageServerTypeHierarchyItem,
  ): Promise<LanguageServerTypeHierarchyItem[]> {
    return this.invokeWhenAvailable(this.commands.typeHierarchySupertypes, { item, rootPath }, []);
  }

  typeHierarchySubtypes(
    rootPath: string,
    item: LanguageServerTypeHierarchyItem,
  ): Promise<LanguageServerTypeHierarchyItem[]> {
    return this.invokeWhenAvailable(this.commands.typeHierarchySubtypes, { item, rootPath }, []);
  }

  executeCommand(
    rootPath: string,
    command: LanguageServerCodeActionCommand,
  ): Promise<LanguageServerWorkspaceEdit | null> {
    return this.invokeWhenAvailable(this.commands.executeCommand, { command, rootPath }, null);
  }

  executeCommandLocations(
    rootPath: string,
    command: LanguageServerCodeActionCommand,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLocationList> {
    return this.invokeBoundedLocationsRequest(
      this.commands.executeCommandLocations,
      { command, rootPath },
      sessionId,
    );
  }

  willCreateFiles(rootPath: string, path: string): Promise<LanguageServerWorkspaceEdit | null> {
    return this.invokeWhenAvailable(this.commands.willCreateFiles, { path, rootPath }, null);
  }

  didCreateFiles(rootPath: string, path: string): Promise<void> {
    return this.invokeWhenAvailable(this.commands.didCreateFiles, { path, rootPath }, undefined);
  }

  willRenameFiles(
    rootPath: string,
    oldPath: string,
    newPath: string,
  ): Promise<LanguageServerWorkspaceEdit | null> {
    return this.invokeWhenAvailable(
      this.commands.willRenameFiles,
      { newPath, oldPath, rootPath },
      null,
    );
  }

  didRenameFiles(rootPath: string, oldPath: string, newPath: string): Promise<void> {
    return this.invokeWhenAvailable(
      this.commands.didRenameFiles,
      { newPath, oldPath, rootPath },
      undefined,
    );
  }

  willDeleteFiles(rootPath: string, path: string): Promise<LanguageServerWorkspaceEdit | null> {
    return this.invokeWhenAvailable(this.commands.willDeleteFiles, { path, rootPath }, null);
  }

  didDeleteFiles(rootPath: string, path: string): Promise<void> {
    return this.invokeWhenAvailable(this.commands.didDeleteFiles, { path, rootPath }, undefined);
  }

  didChangeWatchedFiles(
    rootPath: string,
    changes: LanguageServerWorkspaceFileChange[],
  ): Promise<void> {
    return this.invokeWhenAvailable(
      this.commands.didChangeWatchedFiles,
      { changes, rootPath },
      undefined,
    );
  }

  didChangeConfiguration(
    rootPath: string,
    settings: LanguageServerConfigurationSettings,
  ): Promise<void> {
    return this.invokeWhenAvailable(
      this.commands.didChangeConfiguration,
      { rootPath, settings },
      undefined,
    );
  }

  formatting(
    rootPath: string,
    path: string,
    options: LanguageServerFormattingOptions,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerTextEdit[]> {
    return this.invokeFeatureRequest(
      this.commands.formatting,
      { options, path, rootPath },
      [],
      sessionId,
    );
  }

  onTypeFormatting(
    rootPath: string,
    path: string,
    position: LanguageServerPosition,
    ch: string,
    options: LanguageServerFormattingOptions,
  ): Promise<LanguageServerTextEdit[]> {
    return this.invokeWhenAvailable(
      this.commands.onTypeFormatting,
      { ch, options, path, position, rootPath },
      [],
    );
  }

  rangeFormatting(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
    options: LanguageServerFormattingOptions,
  ): Promise<LanguageServerTextEdit[]> {
    return this.invokeWhenAvailable(
      this.commands.rangeFormatting,
      { options, path, range, rootPath },
      [],
    );
  }

  private async invokeWhenAvailable<T>(
    command: string,
    args: Record<string, unknown>,
    fallback: T,
  ): Promise<T> {
    if (!this.isRuntimeAvailable()) {
      return fallback;
    }

    return (await this.invokeFeatureCommand(command, args)) as T;
  }

  private invokeFeatureRequest<T>(
    command: string,
    args: Record<string, unknown>,
    fallback: T,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<T> {
    const isJavaScriptTypeScriptRequest = command.startsWith("javascript_typescript_");
    if (isJavaScriptTypeScriptRequest && !isAuthorityId(sessionId)) {
      throw new Error("JavaScript/TypeScript language-server request requires an active session.");
    }
    if (sessionId !== undefined && !isAuthorityId(sessionId)) {
      throw new Error("Language-server request requires a valid active session.");
    }
    const requestId = allocateRequestId();
    const identifiedSessionId = sessionId ?? 0;
    const invokeArgs = isAuthorityId(sessionId)
      ? { ...args, requestId, sessionId: identifiedSessionId }
      : args;
    return Object.assign(this.invokeWhenAvailable(command, invokeArgs, fallback), {
      requestId,
      sessionId: identifiedSessionId,
    });
  }

  private invokeBoundedLocationsRequest(
    command: string,
    args: Record<string, unknown>,
    sessionId?: number,
  ): IdentifiedLanguageServerRequest<LanguageServerLocationList> {
    const request = this.invokeFeatureRequest<BoundedLanguageServerLocations>(
      command,
      args,
      { isIncomplete: false, locations: [], totalCount: 0 },
      sessionId,
    );
    const mapped = request.then((result) => {
      const locations = Array.isArray(result) ? result : result.locations;
      const isIncomplete = Array.isArray(result) ? false : result.isIncomplete;
      const totalCount = Array.isArray(result) ? result.length : result.totalCount;
      Object.defineProperties(locations, {
        isIncomplete: { configurable: true, value: isIncomplete },
        totalCount: { configurable: true, value: totalCount },
      });
      return locations;
    });
    return Object.assign(mapped, {
      requestId: request.requestId,
      sessionId: request.sessionId,
    });
  }
}

export function createMonotonicLanguageServerRequestIdAllocator(
  initialRequestId: number = Date.now() * 1_000,
): () => number {
  if (!Number.isSafeInteger(initialRequestId) || initialRequestId < 0) {
    throw new TypeError("Initial language-server request identifier must be a safe integer.");
  }

  let nextRequestId = initialRequestId;
  return () => {
    if (nextRequestId >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Language-server request identifier space is exhausted.");
    }
    nextRequestId += 1;
    return nextRequestId;
  };
}

function isAuthorityId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
