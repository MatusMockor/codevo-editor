import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyLanguageServerCompletionList,
  type LanguageServerCompletionList,
  type LanguageServerFeaturesGateway,
  type LanguageServerHover,
  type LanguageServerLocation,
  type LanguageServerTextDocumentPosition,
} from "../domain/languageServerFeatures";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);
const DEFAULT_FEATURE_COMMANDS = {
  completion: "text_document_completion",
  definition: "text_document_definition",
  hover: "text_document_hover",
  implementation: "text_document_implementation",
};

export const JAVASCRIPT_TYPESCRIPT_FEATURE_COMMANDS = {
  completion: "javascript_typescript_text_document_completion",
  definition: "javascript_typescript_text_document_definition",
  hover: "javascript_typescript_text_document_hover",
  implementation: "javascript_typescript_text_document_implementation",
};

export interface TauriLanguageServerFeatureCommands {
  completion: string;
  definition: string;
  hover: string;
  implementation: string;
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
