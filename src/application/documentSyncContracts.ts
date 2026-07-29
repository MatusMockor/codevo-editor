import type { MutableRefObject } from "react";
import type {
  LanguageServerDocumentSyncGateway,
  LanguageServerTextDocument,
  SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";
import type { LatestValueDrainMailbox } from "./latestValueDrainMailbox";
import type { JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort } from "./javaScriptTypeScriptIncrementalSyncProduction";

/** Shell-owned collaborators and mutable state required by document sync. */
export interface DocumentSyncDependencies {
  largeSmartDocumentPolicy?: LargeSmartDocumentPolicy;

  currentWorkspaceRootRef: MutableRefObject<string | null>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;

  syncedDocumentPathsRef: MutableRefObject<Set<string>>;
  syncedDocumentContentRef: MutableRefObject<Record<string, string>>;
  pendingDocumentChangesRef: MutableRefObject<Record<string, LanguageServerTextDocument>>;
  pendingDocumentOpenSyncAttemptsRef: MutableRefObject<Record<string, number>>;
  documentOpenSyncAttemptIdRef: MutableRefObject<number>;
  documentChangeTimersRef: MutableRefObject<Record<string, number>>;
  documentSyncQueuesRef: MutableRefObject<Record<string, Promise<void>>>;
  documentSyncGenerationRef: MutableRefObject<number>;
  nextDocumentLifecycleIdentityRef: MutableRefObject<number>;
  documentLifecycleIdentitiesRef: MutableRefObject<Record<string, number>>;
  pendingDocumentLifecycleIdentitiesRef: MutableRefObject<Record<string, number>>;
  documentVersionsRef: MutableRefObject<Record<string, number>>;
  documentVersionsByUriRef: MutableRefObject<Record<string, number>>;
  lastAppliedDiagnosticVersionByUriRef: MutableRefObject<Record<string, number>>;
  languageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  languageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  languageServerRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;

  javaScriptTypeScriptSyncedDocumentPathsRef: MutableRefObject<Set<string>>;
  javaScriptTypeScriptSyncedDocumentContentRef: MutableRefObject<Record<string, string>>;
  javaScriptTypeScriptPendingDocumentChangesRef: MutableRefObject<
    Record<string, LanguageServerTextDocument>
  >;
  javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef: MutableRefObject<Record<string, number>>;
  javaScriptTypeScriptDocumentOpenSyncAttemptIdRef: MutableRefObject<number>;
  javaScriptTypeScriptDocumentChangeTimersRef: MutableRefObject<Record<string, number>>;
  javaScriptTypeScriptDocumentSyncQueuesRef: MutableRefObject<Record<string, Promise<void>>>;
  javaScriptTypeScriptDocumentChangeMailbox: LatestValueDrainMailbox<LanguageServerTextDocument>;
  javaScriptTypeScriptDocumentSyncGenerationRef: MutableRefObject<number>;
  javaScriptTypeScriptDocumentVersionsRef: MutableRefObject<Record<string, number>>;
  javaScriptTypeScriptDocumentVersionsByUriRef: MutableRefObject<Record<string, number>>;
  javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef: MutableRefObject<
    Record<string, number>
  >;
  javaScriptTypeScriptLanguageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  javaScriptTypeScriptIncrementalSyncRef?: MutableRefObject<JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort | null>;

  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;

  languageServerDocumentSyncGateway: SessionBoundLanguageServerDocumentSyncGateway;
  javaScriptTypeScriptLanguageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway;

  nextDocumentVersion: (rootPath: string, path: string) => number;
  nextJavaScriptTypeScriptDocumentVersion: (rootPath: string, path: string) => number;
  clearDocumentChangeTimer: (key: string) => void;
  clearJavaScriptTypeScriptDocumentChangeTimer: (key: string) => void;
  enqueueDocumentSync: (path: string, operation: () => Promise<void>) => Promise<void>;
  enqueueJavaScriptTypeScriptDocumentSync: (
    key: string,
    operation: () => Promise<void>,
  ) => Promise<void>;
  resetLanguageServerDocuments: () => void;
  warmUpPhpLanguageServerIndex: (
    rootPath: string,
    path: string,
    requestedSessionId: number,
  ) => void;

  isLanguageServerSessionCurrentForRoot: (rootPath: string, sessionId: number) => boolean;
  isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  isRunningLanguageServerForWorkspace: (
    status: LanguageServerRuntimeStatus | null,
    statusRoot: string | null,
    workspaceRoot: string | null | undefined,
  ) => status is Extract<LanguageServerRuntimeStatus, { kind: "running" }>;
  isSessionPathInWorkspace: (rootPath: string, path: string) => boolean;
  isJavaScriptTypeScriptDocumentSyncableForRoot: (
    rootPath: string,
    document: EditorDocument,
  ) => boolean;

  reportLanguageServerError: (error: unknown) => void;
  reportLanguageServerErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    error: unknown,
  ) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export interface LanguageServerDocumentRequestLease {
  readonly rootPath: string;
  readonly path: string;
  readonly sessionId: number;
  readonly syncGeneration: number;
  readonly lifecycleIdentity: number;
}

export interface DocumentSync {
  isJavaScriptTypeScriptLegacyHandoffSafe: (rootPath: string, path: string) => boolean;
  retireLegacyJavaScriptTypeScriptDocumentForIncrementalHandoff: (
    rootPath: string,
    path: string,
    isCurrent?: () => boolean,
  ) => Promise<boolean>;
  syncOpenDocument: (document: EditorDocument) => Promise<void>;
  syncOpenJavaScriptTypeScriptDocument: (
    document: EditorDocument,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  scheduleDocumentChange: (document: EditorDocument) => void;
  scheduleJavaScriptTypeScriptDocumentChange: (document: EditorDocument) => void;
  flushPendingDocumentChange: (path: string) => Promise<void>;
  flushPendingDocumentChangeForRoot: (requestedRoot: string, path: string) => Promise<void>;
  flushPendingJavaScriptTypeScriptDocumentChange: (path: string) => Promise<void>;
  flushPendingJavaScriptTypeScriptDocumentChangeForRoot: (
    requestedRoot: string,
    path: string,
  ) => Promise<void>;
  isLanguageServerDocumentSynced: (path: string) => boolean;
  getLanguageServerDocumentLifecycleIdentity: (rootPath: string, path: string) => number | null;
  getJavaScriptTypeScriptDocumentSyncVersion: (rootPath: string, path: string) => number | null;
  requestLanguageServerDocumentLease: (
    rootPath: string,
    path: string,
  ) => Promise<LanguageServerDocumentRequestLease | null>;
  isLanguageServerDocumentRequestLeaseCurrent: (
    lease: LanguageServerDocumentRequestLease,
  ) => boolean;
  syncSavedDocument: (
    requestedRoot: string,
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    requestedRoot: string,
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;
  syncClosedDocument: (document: EditorDocument) => Promise<void>;
  syncClosedJavaScriptTypeScriptDocument: (document: EditorDocument) => Promise<void>;
  closeSyncedLanguageServerDocumentsForRoot: (rootPath: string) => Promise<void>;
  closeSyncedJavaScriptTypeScriptDocumentsForRoot: (rootPath: string) => Promise<void>;
}
