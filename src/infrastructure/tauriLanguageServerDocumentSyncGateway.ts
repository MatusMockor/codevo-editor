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

export class TauriLanguageServerDocumentSyncGateway
  implements LanguageServerDocumentSyncGateway
{
  constructor(
    private readonly invokeSyncCommand: InvokeCommand = invokeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  didOpen(document: LanguageServerTextDocument): Promise<void> {
    return this.invokeWhenAvailable("text_document_did_open", { document });
  }

  didChange(document: LanguageServerTextDocument): Promise<void> {
    return this.invokeWhenAvailable("text_document_did_change", { document });
  }

  didSave(document: LanguageServerTextDocument): Promise<void> {
    return this.invokeWhenAvailable("text_document_did_save", { document });
  }

  didClose(path: string): Promise<void> {
    return this.invokeWhenAvailable("text_document_did_close", {
      document: { path },
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
