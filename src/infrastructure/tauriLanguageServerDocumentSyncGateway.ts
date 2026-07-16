import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  LanguageServerDocumentSyncGateway,
  LanguageServerTextDocument,
  SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import { sessionBoundLanguageServerDocumentSyncGateway } from "../domain/languageServerDocumentSync";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<void>;
type RuntimeDetector = () => boolean;

const invokeCommand: InvokeCommand = (command, args) => invoke<void>(command, args);
const PHP_DOCUMENT_SYNC_COMMANDS = {
  didChange: "text_document_did_change",
  didClose: "text_document_did_close",
  didOpen: "text_document_did_open",
  didSave: "text_document_did_save",
};

const JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS = {
  didChange: "javascript_typescript_document_did_change",
  didClose: "javascript_typescript_document_did_close",
  didOpen: "javascript_typescript_document_did_open",
  didSave: "javascript_typescript_document_did_save",
} as const;

interface TauriLanguageServerDocumentSyncCommands {
  readonly didChange: string;
  readonly didClose: string;
  readonly didOpen: string;
  readonly didSave: string;
}

type DocumentSyncOperation = keyof TauriLanguageServerDocumentSyncCommands;

class TauriDocumentSyncInvoker {
  readonly #commands: Readonly<TauriLanguageServerDocumentSyncCommands>;

  constructor(
    private readonly invokeSyncCommand: InvokeCommand = invokeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    commands: Readonly<TauriLanguageServerDocumentSyncCommands>,
  ) {
    this.#commands = Object.freeze({ ...commands });
  }

  invokeWhenAvailable(
    operation: DocumentSyncOperation,
    args: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeSyncCommand(this.#commands[operation], args);
  }
}

export class TauriSessionBoundLanguageServerDocumentSyncGateway
  implements SessionBoundLanguageServerDocumentSyncGateway
{
  readonly #invoker: TauriDocumentSyncInvoker;
  readonly [sessionBoundLanguageServerDocumentSyncGateway] = true as const;

  constructor(
    invokeSyncCommand: InvokeCommand = invokeCommand,
    isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {
    this.#invoker = new TauriDocumentSyncInvoker(
      invokeSyncCommand,
      isRuntimeAvailable,
      PHP_DOCUMENT_SYNC_COMMANDS,
    );
  }

  didOpen(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void> {
    return this.#invoker.invokeWhenAvailable("didOpen", {
      document,
      expectedSessionId,
      rootPath,
    });
  }

  didChange(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void> {
    return this.#invoker.invokeWhenAvailable("didChange", {
      document,
      expectedSessionId,
      rootPath,
    });
  }

  didSave(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void> {
    return this.#invoker.invokeWhenAvailable("didSave", {
      document,
      expectedSessionId,
      rootPath,
    });
  }

  didClose(
    rootPath: string,
    path: string,
    expectedSessionId: number,
  ): Promise<void> {
    return this.#invoker.invokeWhenAvailable("didClose", {
      document: { path },
      expectedSessionId,
      rootPath,
    });
  }
}

export class TauriLanguageServerDocumentSyncGateway
  implements LanguageServerDocumentSyncGateway
{
  readonly #invoker: TauriDocumentSyncInvoker;

  constructor(
    invokeSyncCommand: InvokeCommand = invokeCommand,
    isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {
    this.#invoker = new TauriDocumentSyncInvoker(
      invokeSyncCommand,
      isRuntimeAvailable,
      createJavaScriptTypeScriptDocumentSyncCommands(),
    );
  }

  didOpen(rootPath: string, document: LanguageServerTextDocument): Promise<void> {
    return this.#invoker.invokeWhenAvailable("didOpen", { document, rootPath });
  }

  didChange(rootPath: string, document: LanguageServerTextDocument): Promise<void> {
    return this.#invoker.invokeWhenAvailable("didChange", {
      document,
      rootPath,
    });
  }

  didSave(rootPath: string, document: LanguageServerTextDocument): Promise<void> {
    return this.#invoker.invokeWhenAvailable("didSave", { document, rootPath });
  }

  didClose(rootPath: string, path: string): Promise<void> {
    return this.#invoker.invokeWhenAvailable("didClose", {
      document: { path },
      rootPath,
    });
  }
}

function createJavaScriptTypeScriptDocumentSyncCommands(): typeof JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS {
  return JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS;
}
