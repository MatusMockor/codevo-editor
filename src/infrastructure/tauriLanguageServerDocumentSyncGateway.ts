import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  LanguageServerDocumentSyncGateway,
  LanguageServerTextDocument,
} from "../domain/languageServerDocumentSync";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<void>;
type RuntimeDetector = () => boolean;

const invokeCommand: InvokeCommand = (command, args) => invoke<void>(command, args);
const DEFAULT_DOCUMENT_SYNC_COMMANDS = {
  didChange: "text_document_did_change",
  didClose: "text_document_did_close",
  didOpen: "text_document_did_open",
  didSave: "text_document_did_save",
};

export const JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS = {
  didChange: "javascript_typescript_document_did_change",
  didClose: "javascript_typescript_document_did_close",
  didOpen: "javascript_typescript_document_did_open",
  didSave: "javascript_typescript_document_did_save",
};

export interface TauriLanguageServerDocumentSyncCommands {
  didChange: string;
  didClose: string;
  didOpen: string;
  didSave: string;
}

export class TauriLanguageServerDocumentSyncGateway
  implements LanguageServerDocumentSyncGateway
{
  constructor(
    private readonly invokeSyncCommand: InvokeCommand = invokeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly commands: TauriLanguageServerDocumentSyncCommands =
      DEFAULT_DOCUMENT_SYNC_COMMANDS,
  ) {}

  didOpen(rootPath: string, document: LanguageServerTextDocument): Promise<void> {
    return this.invokeWhenAvailable(this.commands.didOpen, { document, rootPath });
  }

  didChange(rootPath: string, document: LanguageServerTextDocument): Promise<void> {
    return this.invokeWhenAvailable(this.commands.didChange, {
      document,
      rootPath,
    });
  }

  didSave(rootPath: string, document: LanguageServerTextDocument): Promise<void> {
    return this.invokeWhenAvailable(this.commands.didSave, { document, rootPath });
  }

  didClose(rootPath: string, path: string): Promise<void> {
    return this.invokeWhenAvailable(this.commands.didClose, {
      document: { path },
      rootPath,
    });
  }

  private invokeWhenAvailable(
    command: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeSyncCommand(command, args);
  }
}
