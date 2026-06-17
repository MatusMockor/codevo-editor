import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyLanguageServerCompletionList,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeActionContext,
  type LanguageServerCompletionItem,
  type LanguageServerCompletionList,
  type LanguageServerFormattingOptions,
  type LanguageServerFeaturesGateway,
  type LanguageServerHover,
  type LanguageServerInlayHint,
  type LanguageServerLocation,
  type LanguageServerRange,
  type LanguageServerTextEdit,
  type LanguageServerTextDocumentPosition,
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
  executeCommand: "language_server_execute_command",
  formatting: "text_document_formatting",
  hover: "text_document_hover",
  implementation: "text_document_implementation",
  inlayHints: "text_document_inlay_hints",
  references: "text_document_references",
  rename: "text_document_rename",
};

export const JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS = {
  codeActionResolve: "javascript_typescript_text_document_code_action_resolve",
  codeActions: "javascript_typescript_text_document_code_actions",
  completion: "javascript_typescript_text_document_completion",
  completionResolve: "javascript_typescript_text_document_completion_resolve",
  definition: "javascript_typescript_text_document_definition",
  executeCommand: "javascript_typescript_language_server_execute_command",
  formatting: "javascript_typescript_text_document_formatting",
  hover: "javascript_typescript_text_document_hover",
  implementation: "javascript_typescript_text_document_implementation",
  inlayHints: "javascript_typescript_text_document_inlay_hints",
  references: "javascript_typescript_text_document_references",
  rename: "javascript_typescript_text_document_rename",
};

export interface TauriLanguageServerFeatureCommands {
  codeActionResolve: string;
  codeActions: string;
  completion: string;
  completionResolve: string;
  definition: string;
  executeCommand: string;
  formatting: string;
  hover: string;
  implementation: string;
  inlayHints: string;
  references: string;
  rename: string;
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
