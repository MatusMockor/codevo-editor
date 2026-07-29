import type {
  IncrementalDocumentSyncLease,
  LanguageServerDocumentChangeEnvelope,
} from "./incrementalDocumentSync";

export type JavaScriptTypeScriptDocumentLanguageId =
  "javascript" | "javascriptreact" | "typescript" | "typescriptreact";

export interface BoundedLanguageServerDocumentIdentityAuthority {
  readonly documentIncarnation: string;
  readonly modelIncarnation: string;
  readonly ownerGeneration: number;
  readonly ownerIncarnation: string;
  readonly ownerKey: string;
  readonly syncGeneration: number;
}

export interface BoundedLanguageServerDocumentAuthority extends BoundedLanguageServerDocumentIdentityAuthority {
  readonly lifecycleToken: string;
}

interface BoundedLanguageServerDocumentRequest<Authority> {
  readonly authority: Authority;
  readonly expectedSessionId: number;
  readonly rootPath: string;
}

export interface BoundedLanguageServerDidOpenRequest extends BoundedLanguageServerDocumentRequest<BoundedLanguageServerDocumentIdentityAuthority> {
  readonly languageId: JavaScriptTypeScriptDocumentLanguageId;
  readonly path: string;
  readonly predecessorLifecycleToken: string | null;
  readonly text: string;
  readonly version: number;
}

export interface BoundedLanguageServerDidChangeRequest extends BoundedLanguageServerDocumentRequest<BoundedLanguageServerDocumentAuthority> {
  readonly change: LanguageServerDocumentChangeEnvelope;
}

export interface BoundedLanguageServerDidCloseRequest extends BoundedLanguageServerDocumentRequest<BoundedLanguageServerDocumentAuthority> {
  readonly path: string;
  readonly version: number;
}

export type BoundedLanguageServerDocumentSyncFailureReceipt =
  | { readonly kind: "busy" }
  | { readonly kind: "notOpen" }
  | { readonly kind: "staleAuthority" }
  | { readonly kind: "staleSession" }
  | { readonly kind: "staleVersion" };

export type BoundedLanguageServerDocumentSyncReceipt =
  { readonly kind: "admitted" } | BoundedLanguageServerDocumentSyncFailureReceipt;

export type BoundedLanguageServerDidOpenReceipt =
  | { readonly kind: "admitted"; readonly lifecycleToken: string }
  | { readonly kind: "busy" }
  | { readonly kind: "staleAuthority" }
  | { readonly kind: "staleSession" }
  | { readonly kind: "staleVersion" };

export interface IncrementalLanguageServerDocumentSyncGateway {
  didChange(
    request: BoundedLanguageServerDidChangeRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt>;
  didClose(
    request: BoundedLanguageServerDidCloseRequest,
  ): Promise<BoundedLanguageServerDocumentSyncReceipt>;
  didOpen(
    request: BoundedLanguageServerDidOpenRequest,
  ): Promise<BoundedLanguageServerDidOpenReceipt>;
}

export function boundedDocumentSyncIdentityAuthority(
  lease: IncrementalDocumentSyncLease,
  syncGeneration: number,
): BoundedLanguageServerDocumentIdentityAuthority {
  return Object.freeze({
    documentIncarnation: lease.documentIncarnation,
    modelIncarnation: lease.modelIncarnation,
    ownerGeneration: lease.ownerGeneration,
    ownerIncarnation: lease.ownerIncarnation,
    ownerKey: lease.ownerKey,
    syncGeneration,
  });
}

export function boundedDocumentSyncAuthority(
  lease: IncrementalDocumentSyncLease,
  syncGeneration: number,
  lifecycleToken: string,
): BoundedLanguageServerDocumentAuthority {
  return Object.freeze({
    ...boundedDocumentSyncIdentityAuthority(lease, syncGeneration),
    lifecycleToken,
  });
}
