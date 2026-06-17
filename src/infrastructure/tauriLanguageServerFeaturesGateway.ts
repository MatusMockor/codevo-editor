import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyLanguageServerCompletionList,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionContext,
  type LanguageServerCompletionList,
  type LanguageServerFormattingOptions,
  type LanguageServerFeaturesGateway,
  type LanguageServerHover,
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
  codeActions: "text_document_code_actions",
  completion: "text_document_completion",
  definition: "text_document_definition",
  formatting: "text_document_formatting",
  hover: "text_document_hover",
  implementation: "text_document_implementation",
  references: "text_document_references",
  rename: "text_document_rename",
};

export const JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS = {
  codeActions: "javascript_typescript_text_document_code_actions",
  completion: "javascript_typescript_text_document_completion",
  definition: "javascript_typescript_text_document_definition",
  formatting: "javascript_typescript_text_document_formatting",
  hover: "javascript_typescript_text_document_hover",
  implementation: "javascript_typescript_text_document_implementation",
  references: "javascript_typescript_text_document_references",
  rename: "javascript_typescript_text_document_rename",
};

export interface TauriLanguageServerFeatureCommands {
  codeActions: string;
  completion: string;
  definition: string;
  formatting: string;
  hover: string;
  implementation: string;
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
