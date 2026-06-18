import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyLanguageServerCompletionList,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeActionContext,
  type LanguageServerCompletionItem,
  type LanguageServerCompletionList,
  type LanguageServerDocumentHighlight,
  type LanguageServerDocumentLink,
  type LanguageServerDocumentSymbol,
  type LanguageServerFormattingOptions,
  type LanguageServerFeaturesGateway,
  type LanguageServerHover,
  type LanguageServerInlayHint,
  type LanguageServerLocation,
  type LanguageServerPosition,
  type LanguageServerRange,
  type LanguageServerSelectionRange,
  type LanguageServerSignatureHelp,
  type LanguageServerTextEdit,
  type LanguageServerTextDocumentPosition,
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
  completion: "text_document_completion",
  completionResolve: "text_document_completion_resolve",
  definition: "text_document_definition",
  documentHighlights: "text_document_document_highlights",
  documentLinkResolve: "text_document_document_link_resolve",
  documentLinks: "text_document_document_links",
  documentSymbols: "text_document_document_symbols",
  executeCommand: "language_server_execute_command",
  formatting: "text_document_formatting",
  hover: "text_document_hover",
  implementation: "text_document_implementation",
  inlayHints: "text_document_inlay_hints",
  rangeFormatting: "text_document_range_formatting",
  references: "text_document_references",
  rename: "text_document_rename",
  selectionRanges: "text_document_selection_ranges",
  signatureHelp: "text_document_signature_help",
  workspaceSymbols: "workspace_symbols",
};

export const JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS = {
  codeActionResolve: "javascript_typescript_text_document_code_action_resolve",
  codeActions: "javascript_typescript_text_document_code_actions",
  completion: "javascript_typescript_text_document_completion",
  completionResolve: "javascript_typescript_text_document_completion_resolve",
  definition: "javascript_typescript_text_document_definition",
  documentHighlights: "javascript_typescript_text_document_document_highlights",
  documentLinkResolve: "javascript_typescript_text_document_document_link_resolve",
  documentLinks: "javascript_typescript_text_document_document_links",
  documentSymbols: "javascript_typescript_text_document_document_symbols",
  executeCommand: "javascript_typescript_language_server_execute_command",
  formatting: "javascript_typescript_text_document_formatting",
  hover: "javascript_typescript_text_document_hover",
  implementation: "javascript_typescript_text_document_implementation",
  inlayHints: "javascript_typescript_text_document_inlay_hints",
  rangeFormatting: "javascript_typescript_text_document_range_formatting",
  references: "javascript_typescript_text_document_references",
  rename: "javascript_typescript_text_document_rename",
  selectionRanges: "javascript_typescript_text_document_selection_ranges",
  signatureHelp: "javascript_typescript_text_document_signature_help",
  workspaceSymbols: "javascript_typescript_workspace_symbols",
};

export interface TauriLanguageServerFeatureCommands {
  codeActionResolve: string;
  codeActions: string;
  completion: string;
  completionResolve: string;
  definition: string;
  documentHighlights: string;
  documentLinkResolve: string;
  documentLinks: string;
  documentSymbols: string;
  executeCommand: string;
  formatting: string;
  hover: string;
  implementation: string;
  inlayHints: string;
  rangeFormatting: string;
  references: string;
  rename: string;
  selectionRanges: string;
  signatureHelp: string;
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
  ): Promise<LanguageServerCompletionList> {
    return this.invokeWhenAvailable(
      this.commands.completion,
      { position, rootPath },
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
