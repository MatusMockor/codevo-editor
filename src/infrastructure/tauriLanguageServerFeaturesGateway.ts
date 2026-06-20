import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyLanguageServerCompletionList,
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
  type LanguageServerFeaturesGateway,
  type LanguageServerHover,
  type LanguageServerIncomingCall,
  type LanguageServerInlayHint,
  type LanguageServerLinkedEditingRanges,
  type LanguageServerLocation,
  type LanguageServerOutgoingCall,
  type LanguageServerPosition,
  type LanguageServerPrepareRenameResult,
  type LanguageServerRange,
  type LanguageServerSelectionRange,
  type LanguageServerSemanticTokens,
  type LanguageServerSignatureHelp,
  type LanguageServerTextEdit,
  type LanguageServerTextDocumentPosition,
  type LanguageServerTypeHierarchyItem,
  type LanguageServerWorkspaceFileChange,
  type LanguageServerWorkspaceSymbol,
  type LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);
const DEFAULT_FEATURE_COMMANDS = {
  codeActionResolve: "text_document_code_action_resolve",
  codeActions: "text_document_code_actions",
  codeLensResolve: "text_document_code_lens_resolve",
  codeLenses: "text_document_code_lenses",
  completion: "text_document_completion",
  completionResolve: "text_document_completion_resolve",
  definition: "text_document_definition",
  didChangeConfiguration: "workspace_did_change_configuration",
  didChangeWatchedFiles: "workspace_did_change_watched_files",
  didRenameFiles: "workspace_did_rename_files",
  typeDefinition: "text_document_type_definition",
  documentHighlights: "text_document_document_highlights",
  documentLinkResolve: "text_document_document_link_resolve",
  documentLinks: "text_document_document_links",
  documentSymbols: "text_document_document_symbols",
  executeCommand: "language_server_execute_command",
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
  semanticTokens: "text_document_semantic_tokens",
  signatureHelp: "text_document_signature_help",
  typeHierarchySubtypes: "text_document_type_hierarchy_subtypes",
  typeHierarchySupertypes: "text_document_type_hierarchy_supertypes",
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
  definition: "javascript_typescript_text_document_definition",
  didChangeConfiguration:
    "javascript_typescript_workspace_did_change_configuration",
  didChangeWatchedFiles:
    "javascript_typescript_workspace_did_change_watched_files",
  didRenameFiles: "javascript_typescript_workspace_did_rename_files",
  typeDefinition: "javascript_typescript_text_document_type_definition",
  documentHighlights: "javascript_typescript_text_document_document_highlights",
  documentLinkResolve: "javascript_typescript_text_document_document_link_resolve",
  documentLinks: "javascript_typescript_text_document_document_links",
  documentSymbols: "javascript_typescript_text_document_document_symbols",
  executeCommand: "javascript_typescript_language_server_execute_command",
  foldingRanges: "javascript_typescript_text_document_folding_ranges",
  formatting: "javascript_typescript_text_document_formatting",
  hover: "javascript_typescript_text_document_hover",
  incomingCalls: "javascript_typescript_text_document_incoming_calls",
  implementation: "javascript_typescript_text_document_implementation",
  inlayHintResolve: "javascript_typescript_text_document_inlay_hint_resolve",
  inlayHints: "javascript_typescript_text_document_inlay_hints",
  linkedEditingRanges:
    "javascript_typescript_text_document_linked_editing_ranges",
  onTypeFormatting: "javascript_typescript_text_document_on_type_formatting",
  outgoingCalls: "javascript_typescript_text_document_outgoing_calls",
  prepareCallHierarchy:
    "javascript_typescript_text_document_prepare_call_hierarchy",
  prepareRename: "javascript_typescript_text_document_prepare_rename",
  prepareTypeHierarchy:
    "javascript_typescript_text_document_prepare_type_hierarchy",
  rangeFormatting: "javascript_typescript_text_document_range_formatting",
  references: "javascript_typescript_text_document_references",
  rename: "javascript_typescript_text_document_rename",
  selectionRanges: "javascript_typescript_text_document_selection_ranges",
  semanticTokens: "javascript_typescript_text_document_semantic_tokens",
  signatureHelp: "javascript_typescript_text_document_signature_help",
  typeHierarchySubtypes:
    "javascript_typescript_text_document_type_hierarchy_subtypes",
  typeHierarchySupertypes:
    "javascript_typescript_text_document_type_hierarchy_supertypes",
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
  definition: string;
  didChangeConfiguration: string;
  didChangeWatchedFiles: string;
  didRenameFiles: string;
  typeDefinition: string;
  documentHighlights: string;
  documentLinkResolve: string;
  documentLinks: string;
  documentSymbols: string;
  executeCommand: string;
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
  semanticTokens: string;
  signatureHelp: string;
  typeHierarchySubtypes: string;
  typeHierarchySupertypes: string;
  willRenameFiles: string;
  workspaceSymbols: string;
}

export class TauriLanguageServerFeaturesGateway
  implements LanguageServerFeaturesGateway
{
  constructor(
    private readonly invokeFeatureCommand: InvokeCommand = invokeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly commands: TauriLanguageServerFeatureCommands =
      DEFAULT_FEATURE_COMMANDS,
  ) {}

  hover(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerHover | null> {
    return this.invokeWhenAvailable(this.commands.hover, { position, rootPath }, null);
  }

  completion(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    context?: LanguageServerCompletionContext,
  ): Promise<LanguageServerCompletionList> {
    return this.invokeWhenAvailable(
      this.commands.completion,
      { ...(context ? { context } : {}), position, rootPath },
      emptyLanguageServerCompletionList(),
    );
  }

  resolveCompletionItem(
    rootPath: string,
    item: LanguageServerCompletionItem,
  ): Promise<LanguageServerCompletionItem> {
    return this.invokeWhenAvailable(
      this.commands.completionResolve,
      { item, rootPath },
      item,
    );
  }

  definition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]> {
    return this.invokeWhenAvailable(this.commands.definition, { position, rootPath }, []);
  }

  implementation(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]> {
    return this.invokeWhenAvailable(
      this.commands.implementation,
      { position, rootPath },
      [],
    );
  }

  typeDefinition(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]> {
    return this.invokeWhenAvailable(
      this.commands.typeDefinition,
      { position, rootPath },
      [],
    );
  }

  inlayHints(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
  ): Promise<LanguageServerInlayHint[]> {
    return this.invokeWhenAvailable(
      this.commands.inlayHints,
      { path, range, rootPath },
      [],
    );
  }

  resolveInlayHint(
    rootPath: string,
    hint: LanguageServerInlayHint,
  ): Promise<LanguageServerInlayHint> {
    return this.invokeWhenAvailable(
      this.commands.inlayHintResolve,
      { hint, rootPath },
      hint,
    );
  }

  documentSymbols(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerDocumentSymbol[]> {
    return this.invokeWhenAvailable(
      this.commands.documentSymbols,
      { path, rootPath },
      [],
    );
  }

  documentHighlights(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerDocumentHighlight[]> {
    return this.invokeWhenAvailable(
      this.commands.documentHighlights,
      { position, rootPath },
      [],
    );
  }

  documentLinks(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerDocumentLink[]> {
    return this.invokeWhenAvailable(
      this.commands.documentLinks,
      { path, rootPath },
      [],
    );
  }

  resolveDocumentLink(
    rootPath: string,
    link: LanguageServerDocumentLink,
  ): Promise<LanguageServerDocumentLink> {
    return this.invokeWhenAvailable(
      this.commands.documentLinkResolve,
      { link, rootPath },
      link,
    );
  }

  foldingRanges(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerFoldingRange[]> {
    return this.invokeWhenAvailable(
      this.commands.foldingRanges,
      { path, rootPath },
      [],
    );
  }

  workspaceSymbols(
    rootPath: string,
    query: string,
  ): Promise<LanguageServerWorkspaceSymbol[]> {
    return this.invokeWhenAvailable(
      this.commands.workspaceSymbols,
      { query, rootPath },
      [],
    );
  }

  references(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerLocation[]> {
    return this.invokeWhenAvailable(
      this.commands.references,
      { position, rootPath },
      [],
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
  ): Promise<LanguageServerLinkedEditingRanges | null> {
    return this.invokeWhenAvailable(
      this.commands.linkedEditingRanges,
      { position, rootPath },
      null,
    );
  }

  semanticTokens(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerSemanticTokens | null> {
    return this.invokeWhenAvailable(
      this.commands.semanticTokens,
      { path, rootPath },
      null,
    );
  }

  signatureHelp(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerSignatureHelp | null> {
    return this.invokeWhenAvailable(
      this.commands.signatureHelp,
      { position, rootPath },
      null,
    );
  }

  prepareRename(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerPrepareRenameResult | null> {
    return this.invokeWhenAvailable(
      this.commands.prepareRename,
      { position, rootPath },
      null,
    );
  }

  rename(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
    newName: string,
  ): Promise<LanguageServerWorkspaceEdit | null> {
    return this.invokeWhenAvailable(
      this.commands.rename,
      { newName, position, rootPath },
      null,
    );
  }

  codeActions(
    rootPath: string,
    path: string,
    range: LanguageServerRange,
    context: LanguageServerCodeActionContext,
  ): Promise<LanguageServerCodeAction[]> {
    return this.invokeWhenAvailable(
      this.commands.codeActions,
      { context, path, range, rootPath },
      [],
    );
  }

  resolveCodeAction(
    rootPath: string,
    action: LanguageServerCodeAction,
  ): Promise<LanguageServerCodeAction> {
    return this.invokeWhenAvailable(
      this.commands.codeActionResolve,
      { action, rootPath },
      action,
    );
  }

  codeLenses(rootPath: string, path: string): Promise<LanguageServerCodeLens[]> {
    return this.invokeWhenAvailable(
      this.commands.codeLenses,
      { path, rootPath },
      [],
    );
  }

  resolveCodeLens(
    rootPath: string,
    lens: LanguageServerCodeLens,
  ): Promise<LanguageServerCodeLens> {
    return this.invokeWhenAvailable(
      this.commands.codeLensResolve,
      { lens, rootPath },
      lens,
    );
  }

  prepareCallHierarchy(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerCallHierarchyItem[]> {
    return this.invokeWhenAvailable(
      this.commands.prepareCallHierarchy,
      { position, rootPath },
      [],
    );
  }

  incomingCalls(
    rootPath: string,
    item: LanguageServerCallHierarchyItem,
  ): Promise<LanguageServerIncomingCall[]> {
    return this.invokeWhenAvailable(
      this.commands.incomingCalls,
      { item, rootPath },
      [],
    );
  }

  outgoingCalls(
    rootPath: string,
    item: LanguageServerCallHierarchyItem,
  ): Promise<LanguageServerOutgoingCall[]> {
    return this.invokeWhenAvailable(
      this.commands.outgoingCalls,
      { item, rootPath },
      [],
    );
  }

  prepareTypeHierarchy(
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ): Promise<LanguageServerTypeHierarchyItem[]> {
    return this.invokeWhenAvailable(
      this.commands.prepareTypeHierarchy,
      { position, rootPath },
      [],
    );
  }

  typeHierarchySupertypes(
    rootPath: string,
    item: LanguageServerTypeHierarchyItem,
  ): Promise<LanguageServerTypeHierarchyItem[]> {
    return this.invokeWhenAvailable(
      this.commands.typeHierarchySupertypes,
      { item, rootPath },
      [],
    );
  }

  typeHierarchySubtypes(
    rootPath: string,
    item: LanguageServerTypeHierarchyItem,
  ): Promise<LanguageServerTypeHierarchyItem[]> {
    return this.invokeWhenAvailable(
      this.commands.typeHierarchySubtypes,
      { item, rootPath },
      [],
    );
  }

  executeCommand(
    rootPath: string,
    command: LanguageServerCodeActionCommand,
  ): Promise<LanguageServerWorkspaceEdit | null> {
    return this.invokeWhenAvailable(
      this.commands.executeCommand,
      { command, rootPath },
      null,
    );
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

  didRenameFiles(
    rootPath: string,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    return this.invokeWhenAvailable(
      this.commands.didRenameFiles,
      { newPath, oldPath, rootPath },
      undefined,
    );
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
  ): Promise<LanguageServerTextEdit[]> {
    return this.invokeWhenAvailable(
      this.commands.formatting,
      { options, path, rootPath },
      [],
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
}
