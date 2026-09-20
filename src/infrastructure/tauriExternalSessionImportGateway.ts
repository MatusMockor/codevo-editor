import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ExternalSessionImportGateway,
  ExternalSessionImportOwner,
  ExternalSessionImportProgress,
  ImportedSessionHistoryPage,
} from "../domain/externalSessionImport";
import {
  ordinal,
  parseImportedHistoryPage,
  parseSessionImportProgress,
  validateSessionImportOwner,
} from "./tauriExternalSessionImportIpcContract";

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
export class TauriExternalSessionImportGateway implements ExternalSessionImportGateway {
  constructor(
    private readonly invokeCommand: Invoke = invoke,
    private readonly available: () => boolean = isTauri,
  ) {}
  async importSessionHistory(
    request: ExternalSessionImportOwner,
  ): Promise<ExternalSessionImportProgress> {
    const validated = validateSessionImportOwner(request);
    this.ensureAvailable();
    return parseSessionImportProgress(
      await this.invokeCommand("import_agent_session_history", { request: validated }),
    );
  }
  async readImportedHistory(
    request: ExternalSessionImportOwner & { readonly beforeOrdinal: number | null },
  ): Promise<ImportedSessionHistoryPage> {
    const validated = {
      ...validateSessionImportOwner(request),
      beforeOrdinal: request.beforeOrdinal === null ? null : ordinal(request.beforeOrdinal),
    };
    this.ensureAvailable();
    return parseImportedHistoryPage(
      await this.invokeCommand("read_agent_imported_history", { request: validated }),
    );
  }
  private ensureAvailable(): void {
    if (!this.available()) throw new Error("Importing session history requires the desktop app.");
  }
}
