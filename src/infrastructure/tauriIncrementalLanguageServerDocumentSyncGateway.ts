import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  BoundedLanguageServerDidChangeRequest,
  BoundedLanguageServerDidCloseRequest,
  BoundedLanguageServerDidOpenReceipt,
  BoundedLanguageServerDidOpenRequest,
  BoundedLanguageServerDocumentSyncReceipt,
  IncrementalLanguageServerDocumentSyncGateway,
} from "../domain/incrementalLanguageServerDocumentSync";
import {
  decodeBoundedDidOpenReceipt,
  decodeBoundedDocumentSyncReceipt,
  encodeBoundedLanguageServerDidChangeRequest,
  encodeBoundedLanguageServerDidCloseRequest,
  encodeBoundedLanguageServerDidOpenRequest,
} from "./tauriIncrementalLanguageServerDocumentSyncIpcContract";

export const BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS = Object.freeze({
  didChange: "javascript_typescript_document_did_change_bounded",
  didClose: "javascript_typescript_document_did_close_bounded",
  didOpen: "javascript_typescript_document_did_open_bounded",
});

type InvokeCommand = (command: string, args: { readonly request: unknown }) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriIncrementalLanguageServerDocumentSyncGateway implements IncrementalLanguageServerDocumentSyncGateway {
  constructor(
    private readonly invokeRuntimeCommand: InvokeCommand = invokeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async didOpen(
    request: BoundedLanguageServerDidOpenRequest,
  ): Promise<BoundedLanguageServerDidOpenReceipt> {
    const encoded = encodeBoundedLanguageServerDidOpenRequest(request);
    if (!this.isRuntimeAvailable()) {
      return STALE_SESSION_RECEIPT;
    }
    const result = await this.invokeRuntimeCommand(
      BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS.didOpen,
      { request: encoded },
    );
    return decodeBoundedDidOpenReceipt(result);
  }

  async didChange(
    request: BoundedLanguageServerDidChangeRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    return await this.invoke("didChange", encodeBoundedLanguageServerDidChangeRequest(request));
  }

  async didClose(
    request: BoundedLanguageServerDidCloseRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    return await this.invoke("didClose", encodeBoundedLanguageServerDidCloseRequest(request));
  }

  private async invoke(
    operation: keyof typeof BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS,
    request: unknown,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt> {
    if (!this.isRuntimeAvailable()) {
      return STALE_SESSION_RECEIPT;
    }
    const result = await this.invokeRuntimeCommand(
      BOUNDED_JAVASCRIPT_TYPESCRIPT_DOCUMENT_SYNC_COMMANDS[operation],
      { request },
    );
    return decodeBoundedDocumentSyncReceipt(result);
  }
}

const STALE_SESSION_RECEIPT = Object.freeze({
  kind: "staleSession" as const,
});
