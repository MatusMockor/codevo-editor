import type { ExternalAgentSessionHistory } from "./externalAgentSession";

export interface ExternalSessionImportOwner {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
}
export interface ExternalSessionImportProgress {
  readonly complete: boolean;
  readonly importedCount: number;
  readonly truncated: boolean;
}
export interface ImportedSessionHistoryPage {
  readonly history: ExternalAgentSessionHistory;
  readonly hasEarlier: boolean;
  readonly beforeOrdinal: number | null;
  readonly complete: boolean;
}
export interface ExternalSessionImportGateway {
  importSessionHistory(request: ExternalSessionImportOwner): Promise<ExternalSessionImportProgress>;
  readImportedHistory(
    request: ExternalSessionImportOwner & { readonly beforeOrdinal: number | null },
  ): Promise<ImportedSessionHistoryPage>;
}
