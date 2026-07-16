// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDocumentSync,
  type DocumentSync,
  type DocumentSyncDependencies,
} from "./useDocumentSync";
import {
  fileUriFromPath,
  isJavaScriptTypeScriptLanguageServerDocument,
  languageServerDocumentSyncKey,
  languageServerUriSyncKey,
  sessionBoundLanguageServerDocumentSyncGateway,
  type LanguageServerDocumentSyncGateway,
  type SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import { cachedLanguageServerRuntimeStatusForRoot } from "../domain/languageServerRuntimeStatusCache";
import {
  LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
} from "../domain/largeDocumentPolicy";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROOT = "/workspace";
const OTHER_ROOT = "/other-workspace";
const SESSION = 7;

type MutableRef<T> = { current: T };

function ref<T>(value: T): MutableRef<T> {
  return { current: value };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function runningStatus(
  rootPath: string,
  sessionId: number,
): LanguageServerRuntimeStatus {
  return {
    kind: "running",
    rootPath,
    sessionId,
    capabilities: {},
  } as LanguageServerRuntimeStatus;
}

function phpDocument(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "a",
    language: "php",
    name: "User.php",
    path: `${ROOT}/app/User.php`,
    savedContent: "a",
    ...overrides,
  };
}

function tsDocument(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "a",
    language: "typescript",
    name: "index.ts",
    path: `${ROOT}/src/index.ts`,
    savedContent: "a",
    ...overrides,
  };
}

function createSyncGatewaySpy(): LanguageServerDocumentSyncGateway &
  SessionBoundLanguageServerDocumentSyncGateway {
  return {
    [sessionBoundLanguageServerDocumentSyncGateway]: true,
    didOpen: vi.fn(async () => undefined),
    didChange: vi.fn(async () => undefined),
    didSave: vi.fn(async () => undefined),
    didClose: vi.fn(async () => undefined),
  };
}

// Faithful reconstruction of the shell's status/session guards. Mirrors the
// controller's isLanguageServerStatusForWorkspace + running/session checks so
// the injected guards behave exactly as the real ones would.
function isRunningForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  if (!workspaceRoot || !status) {
    return false;
  }

  const rootedStatus =
    status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  if (!rootedStatus || !workspaceRootKeysEqual(rootedStatus, workspaceRoot)) {
    return false;
  }

  return status.kind === "running";
}

function normalizedSessionPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

function isSessionPathInWorkspace(rootPath: string, path: string): boolean {
  const root = normalizedSessionPath(rootPath);
  const candidate = normalizedSessionPath(path);

  if (candidate === root) {
    return true;
  }

  return candidate.startsWith(`${root}/`);
}

function isJavaScriptTypeScriptDocumentSyncableForRoot(
  rootPath: string,
  document: EditorDocument,
): boolean {
  return (
    document.readOnly !== true &&
    isJavaScriptTypeScriptLanguageServerDocument(document) &&
    isSessionPathInWorkspace(rootPath, document.path)
  );
}

interface FamilyRefs {
  syncedPaths: MutableRef<Set<string>>;
  syncedContent: MutableRef<Record<string, string>>;
  pendingChanges: MutableRef<
    Record<string, import("../domain/languageServerDocumentSync").LanguageServerTextDocument>
  >;
  pendingOpenAttempts: MutableRef<Record<string, number>>;
  openAttemptId: MutableRef<number>;
  changeTimers: MutableRef<Record<string, number>>;
  syncQueues: MutableRef<Record<string, Promise<void>>>;
  generation: MutableRef<number>;
  versions: MutableRef<Record<string, number>>;
  versionsByUri: MutableRef<Record<string, number>>;
  lastAppliedByUri: MutableRef<Record<string, number>>;
  statusRef: MutableRef<LanguageServerRuntimeStatus | null>;
  statusRootRef: MutableRef<string | null>;
  statusByRootRef: MutableRef<Record<string, LanguageServerRuntimeStatus>>;
}

function createFamilyRefs(): FamilyRefs {
  return {
    syncedPaths: ref(new Set<string>()),
    syncedContent: ref({}),
    pendingChanges: ref({}),
    pendingOpenAttempts: ref({}),
    openAttemptId: ref(0),
    changeTimers: ref({}),
    syncQueues: ref({}),
    generation: ref(0),
    versions: ref({}),
    versionsByUri: ref({}),
    lastAppliedByUri: ref({}),
    statusRef: ref<LanguageServerRuntimeStatus | null>(null),
    statusRootRef: ref<string | null>(null),
    statusByRootRef: ref<Record<string, LanguageServerRuntimeStatus>>({}),
  };
}

// Real (shell-equivalent) sync primitives over a family's refs.
function makePrimitives(refs: FamilyRefs) {
  const nextVersion = (rootPath: string, path: string): number => {
    const key = languageServerDocumentSyncKey(rootPath, path);
    const next = (refs.versions.current[key] || 0) + 1;
    refs.versions.current[key] = next;
    refs.versionsByUri.current[
      languageServerUriSyncKey(rootPath, fileUriFromPath(path))
    ] = next;
    return next;
  };

  const clearTimer = (key: string): void => {
    const timer = refs.changeTimers.current[key];

    if (!timer) {
      return;
    }

    window.clearTimeout(timer);
    delete refs.changeTimers.current[key];
  };

  const enqueue = (key: string, operation: () => Promise<void>): Promise<void> => {
    const previous = refs.syncQueues.current[key] || Promise.resolve();
    const next = previous.then(operation, operation);
    const queued = next.catch(() => undefined);
    refs.syncQueues.current[key] = queued;

    queued.finally(() => {
      if (refs.syncQueues.current[key] !== queued) {
        return;
      }

      delete refs.syncQueues.current[key];
    });

    return next;
  };

  const sessionCurrent = (rootPath: string, sessionId: number): boolean => {
    const current =
      cachedLanguageServerRuntimeStatusForRoot(
        refs.statusByRootRef.current,
        rootPath,
      ) ??
      (workspaceRootKeysEqual(refs.statusRootRef.current, rootPath)
        ? refs.statusRef.current
        : null);

    return (
      isRunningForWorkspace(
        current,
        current?.rootPath ?? refs.statusRootRef.current,
        rootPath,
      ) && current.sessionId === sessionId
    );
  };

  return { nextVersion, clearTimer, enqueue, sessionCurrent };
}

interface Harness {
  deps: DocumentSyncDependencies;
  php: ReturnType<typeof createFamilyRefs>;
  jsts: ReturnType<typeof createFamilyRefs>;
  phpGateway: SessionBoundLanguageServerDocumentSyncGateway;
  jstsGateway: LanguageServerDocumentSyncGateway;
  currentRootRef: MutableRef<string | null>;
  activeDocumentRef: MutableRef<EditorDocument | null>;
  documentsRef: MutableRef<Record<string, EditorDocument>>;
  warmUp: ReturnType<typeof vi.fn>;
  reportLanguageServerError: ReturnType<typeof vi.fn>;
  reportErrorForActiveWorkspaceRoot: ReturnType<typeof vi.fn>;
}

function createHarness(): Harness {
  const php = createFamilyRefs();
  const jsts = createFamilyRefs();
  const currentRootRef = ref<string | null>(ROOT);
  const activeDocumentRef = ref<EditorDocument | null>(null);
  const documentsRef = ref<Record<string, EditorDocument>>({});
  const phpGateway = createSyncGatewaySpy();
  const jstsGateway = createSyncGatewaySpy();

  // Both language servers are running on ROOT with the same session.
  const status = runningStatus(ROOT, SESSION);
  php.statusRef.current = status;
  php.statusRootRef.current = ROOT;
  php.statusByRootRef.current = { [ROOT]: status };
  jsts.statusRef.current = status;
  jsts.statusRootRef.current = ROOT;
  jsts.statusByRootRef.current = { [ROOT]: status };

  const phpPrimitives = makePrimitives(php);
  const jstsPrimitives = makePrimitives(jsts);

  const warmUp = vi.fn();
  const reportLanguageServerError = vi.fn();
  const reportLanguageServerErrorForActiveWorkspaceRoot = vi.fn();
  const reportErrorForActiveWorkspaceRoot = vi.fn();
  const nextDocumentLifecycleIdentityRef = ref(0);
  const documentLifecycleIdentitiesRef = ref<Record<string, number>>({});
  const pendingDocumentLifecycleIdentitiesRef = ref<Record<string, number>>({});

  const resetLanguageServerDocuments = vi.fn(() => {
    php.generation.current += 1;
    Object.keys(php.changeTimers.current).forEach(phpPrimitives.clearTimer);
    php.syncedPaths.current.clear();
    php.syncedContent.current = {};
    php.pendingChanges.current = {};
    php.pendingOpenAttempts.current = {};
    php.versions.current = {};
    php.versionsByUri.current = {};
    php.lastAppliedByUri.current = {};
    php.syncQueues.current = {};
    documentLifecycleIdentitiesRef.current = {};
    pendingDocumentLifecycleIdentitiesRef.current = {};
  });

  const deps: DocumentSyncDependencies = {
    currentWorkspaceRootRef: currentRootRef,
    activeDocumentRef,
    documentsRef,

    syncedDocumentPathsRef: php.syncedPaths,
    syncedDocumentContentRef: php.syncedContent,
    pendingDocumentChangesRef: php.pendingChanges,
    pendingDocumentOpenSyncAttemptsRef: php.pendingOpenAttempts,
    documentOpenSyncAttemptIdRef: php.openAttemptId,
    documentChangeTimersRef: php.changeTimers,
    documentSyncQueuesRef: php.syncQueues,
    documentSyncGenerationRef: php.generation,
    nextDocumentLifecycleIdentityRef,
    documentLifecycleIdentitiesRef,
    pendingDocumentLifecycleIdentitiesRef,
    documentVersionsRef: php.versions,
    documentVersionsByUriRef: php.versionsByUri,
    lastAppliedDiagnosticVersionByUriRef: php.lastAppliedByUri,
    languageServerRuntimeStatusRef: php.statusRef,
    languageServerRuntimeStatusRootRef: php.statusRootRef,
    languageServerRuntimeStatusByRootRef: php.statusByRootRef,

    javaScriptTypeScriptSyncedDocumentPathsRef: jsts.syncedPaths,
    javaScriptTypeScriptSyncedDocumentContentRef: jsts.syncedContent,
    javaScriptTypeScriptPendingDocumentChangesRef: jsts.pendingChanges,
    javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef: jsts.pendingOpenAttempts,
    javaScriptTypeScriptDocumentOpenSyncAttemptIdRef: jsts.openAttemptId,
    javaScriptTypeScriptDocumentChangeTimersRef: jsts.changeTimers,
    javaScriptTypeScriptDocumentSyncQueuesRef: jsts.syncQueues,
    javaScriptTypeScriptDocumentSyncGenerationRef: jsts.generation,
    javaScriptTypeScriptDocumentVersionsRef: jsts.versions,
    javaScriptTypeScriptDocumentVersionsByUriRef: jsts.versionsByUri,
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef: jsts.lastAppliedByUri,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef: jsts.statusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: jsts.statusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef: jsts.statusByRootRef,

    languageServerRuntimeStatus: status,
    languageServerRuntimeStatusRoot: ROOT,
    javaScriptTypeScriptLanguageServerRuntimeStatus: status,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,

    languageServerDocumentSyncGateway: phpGateway,
    javaScriptTypeScriptLanguageServerDocumentSyncGateway: jstsGateway,

    nextDocumentVersion: phpPrimitives.nextVersion,
    nextJavaScriptTypeScriptDocumentVersion: jstsPrimitives.nextVersion,
    clearDocumentChangeTimer: phpPrimitives.clearTimer,
    clearJavaScriptTypeScriptDocumentChangeTimer: jstsPrimitives.clearTimer,
    enqueueDocumentSync: phpPrimitives.enqueue,
    enqueueJavaScriptTypeScriptDocumentSync: jstsPrimitives.enqueue,
    resetLanguageServerDocuments,
    warmUpPhpLanguageServerIndex: warmUp,

    isLanguageServerSessionCurrentForRoot: phpPrimitives.sessionCurrent,
    isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot:
      jstsPrimitives.sessionCurrent,
    isRunningLanguageServerForWorkspace: isRunningForWorkspace,
    isSessionPathInWorkspace,
    isJavaScriptTypeScriptDocumentSyncableForRoot,

    reportLanguageServerError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    reportErrorForActiveWorkspaceRoot,
  };

  return {
    deps,
    php,
    jsts,
    phpGateway,
    jstsGateway,
    currentRootRef,
    activeDocumentRef,
    documentsRef,
    warmUp,
    reportLanguageServerError,
    reportErrorForActiveWorkspaceRoot,
  };
}

function renderDocumentSync(deps: DocumentSyncDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: DocumentSync | null } = { api: null };

  function Harness({ dependencies }: { dependencies: DocumentSyncDependencies }) {
    captured.api = useDocumentSync(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  return {
    api: (): DocumentSync => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    rerender: (dependencies: DocumentSyncDependencies) => {
      act(() => {
        root.render(<Harness dependencies={dependencies} />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("useDocumentSync - PHP (phpactor) family", () => {
  it("opens a document with version 1 and warms the index", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument({ content: "a" });

    await api().syncOpenDocument(document);

    const key = languageServerDocumentSyncKey(ROOT, document.path);
    expect(harness.phpGateway.didOpen).toHaveBeenCalledTimes(1);
    expect(harness.phpGateway.didOpen).toHaveBeenCalledWith(ROOT, {
      languageId: "php",
      path: document.path,
      text: "a",
      version: 1,
    }, SESSION);
    expect(harness.php.syncedPaths.current.has(key)).toBe(true);
    expect(harness.warmUp).toHaveBeenCalledWith(ROOT, document.path, SESSION);
  });

  it("assigns a new lifecycle identity when the same path closes and reopens", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument();

    await api().syncOpenDocument(document);
    const firstLifecycle = api().getLanguageServerDocumentLifecycleIdentity(
      ROOT,
      document.path,
    );

    await api().syncClosedDocument(document);
    expect(
      api().getLanguageServerDocumentLifecycleIdentity(ROOT, document.path),
    ).toBeNull();

    await api().syncOpenDocument(document);
    const secondLifecycle = api().getLanguageServerDocumentLifecycleIdentity(
      ROOT,
      document.path,
    );

    expect(firstLifecycle).toBe(1);
    expect(secondLifecycle).toBe(2);
    expect(
      api().getLanguageServerDocumentLifecycleIdentity(
        `${ROOT}-neighbor`,
        document.path,
      ),
    ).toBeNull();
  });

  it("does not reuse lifecycle identities across document paths", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const firstDocument = phpDocument({ path: `${ROOT}/src/First.php` });
    const secondDocument = phpDocument({ path: `${ROOT}/src/Second.php` });

    await api().syncOpenDocument(firstDocument);
    const firstLifecycle = api().getLanguageServerDocumentLifecycleIdentity(
      ROOT,
      firstDocument.path,
    );
    await api().syncClosedDocument(firstDocument);
    await api().syncOpenDocument(secondDocument);
    const secondLifecycle = api().getLanguageServerDocumentLifecycleIdentity(
      ROOT,
      secondDocument.path,
    );

    expect(firstLifecycle).toBe(1);
    expect(secondLifecycle).toBe(2);
  });

  it("returns a root-bound lease only after didOpen completes", async () => {
    const harness = createHarness();
    const open = deferred<void>();
    vi.mocked(harness.phpGateway.didOpen).mockImplementation(
      async () => open.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument();
    harness.activeDocumentRef.current = document;
    let leaseSettled = false;

    const leasePromise = api()
      .requestLanguageServerDocumentLease(ROOT, document.path)
      .finally(() => {
        leaseSettled = true;
      });
    await flushMicrotasks();

    expect(harness.phpGateway.didOpen).toHaveBeenCalledTimes(1);
    expect(leaseSettled).toBe(false);
    expect(api().isLanguageServerDocumentSynced(document.path)).toBe(false);

    open.resolve();
    const lease = await leasePromise;

    expect(lease?.lifecycleIdentity).toBe(1);
    expect(
      lease && api().isLanguageServerDocumentRequestLeaseCurrent(lease),
    ).toBe(true);
  });

  it("does not lease a document when didOpen fails", async () => {
    const harness = createHarness();
    vi.mocked(harness.phpGateway.didOpen).mockRejectedValue(
      new Error("open failed"),
    );
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument();
    harness.activeDocumentRef.current = document;

    const lease = await api().requestLanguageServerDocumentLease(
      ROOT,
      document.path,
    );

    expect(lease).toBeNull();
    expect(api().isLanguageServerDocumentSynced(document.path)).toBe(false);
    expect(harness.reportLanguageServerError).toHaveBeenCalledTimes(1);
  });

  it("does not replace an in-flight request with a reopened path's lease", async () => {
    const harness = createHarness();
    const firstOpen = deferred<void>();
    vi.mocked(harness.phpGateway.didOpen)
      .mockImplementationOnce(async () => firstOpen.promise)
      .mockResolvedValue(undefined);
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument();
    harness.activeDocumentRef.current = document;

    const firstRequest = api().requestLanguageServerDocumentLease(
      ROOT,
      document.path,
    );
    await flushMicrotasks();
    const closeRequest = api().syncClosedDocument(document);
    const secondRequest = api().requestLanguageServerDocumentLease(
      ROOT,
      document.path,
    );

    firstOpen.resolve();
    const [firstLease, secondLease] = await Promise.all([
      firstRequest,
      secondRequest,
      closeRequest,
    ]);

    expect(firstLease).toBeNull();
    expect(secondLease?.lifecycleIdentity).toBe(2);
    expect(harness.phpGateway.didOpen).toHaveBeenCalledTimes(2);
    expect(harness.phpGateway.didClose).toHaveBeenCalledTimes(1);
  });

  it("clears lifecycle identities atomically when reset interrupts didOpen", async () => {
    const harness = createHarness();
    const firstOpen = deferred<void>();
    vi.mocked(harness.phpGateway.didOpen)
      .mockImplementationOnce(async () => firstOpen.promise)
      .mockResolvedValue(undefined);
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument();
    harness.activeDocumentRef.current = document;

    const firstLease = api().requestLanguageServerDocumentLease(
      ROOT,
      document.path,
    );
    await flushMicrotasks();
    const reset = api().closeSyncedLanguageServerDocumentsForRoot(ROOT);

    expect(harness.deps.resetLanguageServerDocuments).toHaveBeenCalledTimes(1);
    expect(
      api().getLanguageServerDocumentLifecycleIdentity(ROOT, document.path),
    ).toBeNull();

    firstOpen.resolve();
    await expect(firstLease).resolves.toBeNull();
    await reset;

    const replacementLease = await api().requestLanguageServerDocumentLease(
      ROOT,
      document.path,
    );

    expect(replacementLease?.lifecycleIdentity).toBe(2);
    expect(
      replacementLease &&
        api().isLanguageServerDocumentRequestLeaseCurrent(replacementLease),
    ).toBe(true);
  });

  it("invalidates leases across close, root switch, and reopen", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument();
    harness.activeDocumentRef.current = document;
    const firstLease = await api().requestLanguageServerDocumentLease(
      ROOT,
      document.path,
    );

    expect(firstLease).not.toBeNull();
    harness.currentRootRef.current = OTHER_ROOT;
    expect(
      firstLease &&
        api().isLanguageServerDocumentRequestLeaseCurrent(firstLease),
    ).toBe(false);

    harness.currentRootRef.current = ROOT;
    const replacementSession = runningStatus(ROOT, SESSION + 1);
    harness.php.statusRef.current = replacementSession;
    harness.php.statusByRootRef.current = { [ROOT]: replacementSession };
    expect(
      firstLease &&
        api().isLanguageServerDocumentRequestLeaseCurrent(firstLease),
    ).toBe(false);

    const originalSession = runningStatus(ROOT, SESSION);
    harness.php.statusRef.current = originalSession;
    harness.php.statusByRootRef.current = { [ROOT]: originalSession };
    await api().syncClosedDocument(document);
    expect(
      firstLease &&
        api().isLanguageServerDocumentRequestLeaseCurrent(firstLease),
    ).toBe(false);

    const secondLease = await api().requestLanguageServerDocumentLease(
      ROOT,
      document.path,
    );

    expect(secondLease?.lifecycleIdentity).toBe(2);
    expect(
      secondLease &&
        api().isLanguageServerDocumentRequestLeaseCurrent(secondLease),
    ).toBe(true);
  });

  it("does not sync huge PHP documents to phpactor", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument({
      content: "x".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
    });

    await api().syncOpenDocument(document);

    const key = languageServerDocumentSyncKey(ROOT, document.path);
    expect(harness.phpGateway.didOpen).not.toHaveBeenCalled();
    expect(harness.php.syncedPaths.current.has(key)).toBe(false);
    expect(harness.warmUp).not.toHaveBeenCalled();
  });

  it("uses the configured large document policy before syncing PHP documents", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync({
      ...harness.deps,
      largeSmartDocumentPolicy: {
        characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
        lineLimit: 5_000,
      },
    });
    const document = phpDocument({
      content: "x".repeat(MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
    });

    await api().syncOpenDocument(document);

    expect(harness.phpGateway.didOpen).not.toHaveBeenCalled();
    expect(harness.warmUp).not.toHaveBeenCalled();
  });

  it("debounces rapid edits into a single didChange carrying the latest version", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const path = phpDocument().path;

    await api().syncOpenDocument(phpDocument({ content: "a" }));

    api().scheduleDocumentChange(phpDocument({ content: "ab" }));
    api().scheduleDocumentChange(phpDocument({ content: "abc" }));

    // Before the debounce elapses nothing is sent.
    expect(harness.phpGateway.didChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(1);
    // Each schedule bumps the monotonic version (v2 for "ab", v3 for "abc");
    // the coalesced didChange carries the latest content AND the latest version.
    expect(harness.phpGateway.didChange).toHaveBeenCalledWith(ROOT, {
      languageId: "php",
      path,
      text: "abc",
      version: 3,
    }, SESSION);
  });

  it("does not send huge PHP edits after a normal document was synced", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const path = phpDocument().path;

    await api().syncOpenDocument(phpDocument({ content: "a" }));
    api().scheduleDocumentChange(
      phpDocument({
        content: "x".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
      }),
    );

    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    const key = languageServerDocumentSyncKey(ROOT, path);
    expect(harness.phpGateway.didChange).not.toHaveBeenCalled();
    expect(harness.php.syncedContent.current[key]).toHaveLength(
      LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1,
    );
  });

  it("flushes a pending change immediately and cancels the debounce", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument({ content: "ab" });

    await api().syncOpenDocument(phpDocument({ content: "a" }));
    api().scheduleDocumentChange(document);

    await api().flushPendingDocumentChange(document.path);
    await flushMicrotasks();

    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(1);
    expect(harness.phpGateway.didChange).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ text: "ab", version: 2 }),
      SESSION,
    );

    // The debounce timer was cancelled by the flush: advancing it sends nothing.
    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();
    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(1);
  });

  it("does not let a deferred debounced PHP didChange complete into a reopened lifecycle", async () => {
    const harness = createHarness();
    const change = deferred<void>();
    vi.mocked(harness.phpGateway.didChange).mockImplementationOnce(
      async () => change.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const staleDocument = phpDocument({ content: "stale" });
    const reopenedDocument = phpDocument({ content: "reopened" });
    const freshDocument = phpDocument({ content: "fresh" });
    const syncKey = languageServerDocumentSyncKey(ROOT, staleDocument.path);

    await api().syncOpenDocument(phpDocument({ content: "original" }));
    api().scheduleDocumentChange(staleDocument);
    await vi.advanceTimersByTimeAsync(150);
    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(1);

    const close = api().syncClosedDocument(staleDocument);
    const reopen = api().syncOpenDocument(reopenedDocument);
    api().scheduleDocumentChange(freshDocument);
    change.resolve();
    await Promise.all([close, reopen]);

    expect(harness.php.syncedContent.current[syncKey]).toBe("reopened");
    expect(harness.php.pendingChanges.current[syncKey]).toEqual(
      expect.objectContaining({ text: "fresh", version: 2 }),
    );

    await api().flushPendingDocumentChange(freshDocument.path);
    expect(harness.php.syncedContent.current[syncKey]).toBe("fresh");
    expect(harness.php.pendingChanges.current[syncKey]).toBeUndefined();
  });

  it("does not let a deferred explicit PHP flush complete into a reopened lifecycle", async () => {
    const harness = createHarness();
    const change = deferred<void>();
    vi.mocked(harness.phpGateway.didChange).mockImplementationOnce(
      async () => change.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const staleDocument = phpDocument({ content: "stale" });
    const reopenedDocument = phpDocument({ content: "reopened" });
    const freshDocument = phpDocument({ content: "fresh" });
    const syncKey = languageServerDocumentSyncKey(ROOT, staleDocument.path);

    await api().syncOpenDocument(phpDocument({ content: "original" }));
    api().scheduleDocumentChange(staleDocument);
    const flush = api().flushPendingDocumentChange(staleDocument.path);
    await flushMicrotasks();
    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(1);

    const close = api().syncClosedDocument(staleDocument);
    const reopen = api().syncOpenDocument(reopenedDocument);
    api().scheduleDocumentChange(freshDocument);
    change.resolve();
    await Promise.all([flush, close, reopen]);

    expect(harness.php.syncedContent.current[syncKey]).toBe("reopened");
    expect(harness.php.pendingChanges.current[syncKey]).toEqual(
      expect.objectContaining({ text: "fresh", version: 2 }),
    );

    await api().flushPendingDocumentChange(freshDocument.path);
    expect(harness.php.syncedContent.current[syncKey]).toBe("fresh");
    expect(harness.php.pendingChanges.current[syncKey]).toBeUndefined();
  });

  it("retains a failed PHP pending change for a monotonic save retry", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const originalDocument = phpDocument({ content: "a" });
    const editedDocument = phpDocument({ content: "ab" });
    const syncKey = languageServerDocumentSyncKey(ROOT, editedDocument.path);
    vi.mocked(harness.phpGateway.didChange).mockRejectedValueOnce(
      new Error("didChange failed"),
    );

    await api().syncOpenDocument(originalDocument);
    api().scheduleDocumentChange(editedDocument);
    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    expect(harness.phpGateway.didChange).toHaveBeenNthCalledWith(1, ROOT, {
      languageId: "php",
      path: editedDocument.path,
      text: "ab",
      version: 2,
    }, SESSION);
    expect(harness.php.syncedContent.current[syncKey]).toBe("a");
    expect(harness.php.pendingChanges.current[syncKey]).toEqual(
      expect.objectContaining({ text: "ab", version: 3 }),
    );

    await api().syncSavedDocument(ROOT, editedDocument);

    expect(harness.phpGateway.didChange).toHaveBeenNthCalledWith(2, ROOT, {
      languageId: "php",
      path: editedDocument.path,
      text: "ab",
      version: 3,
    }, SESSION);
    expect(harness.phpGateway.didSave).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ text: "ab", version: 3 }),
      SESSION,
    );
    expect(harness.php.syncedContent.current[syncKey]).toBe("ab");
    expect(harness.php.pendingChanges.current[syncKey]).toBeUndefined();
    expect(harness.php.versions.current[syncKey]).toBe(3);
  });

  it("saves a document with its current version after flushing pending changes", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument({ content: "a" });

    await api().syncOpenDocument(document);
    await api().syncSavedDocument(ROOT, document);
    await flushMicrotasks();

    expect(harness.phpGateway.didSave).toHaveBeenCalledTimes(1);
    expect(harness.phpGateway.didSave).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ path: document.path, version: 1 }),
      SESSION,
    );
    expect(harness.phpGateway.didChange).not.toHaveBeenCalled();
  });

  it("does not mutate pending state or save for a mismatched explicit root", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument({ content: "ab" });
    const key = languageServerDocumentSyncKey(ROOT, document.path);

    await api().syncOpenDocument(phpDocument({ content: "a" }));
    api().scheduleDocumentChange(document);
    const pendingDocument = harness.php.pendingChanges.current[key];
    const timer = harness.php.changeTimers.current[key];

    await api().flushPendingDocumentChangeForRoot(OTHER_ROOT, document.path);
    await api().syncSavedDocument(OTHER_ROOT, document);

    expect(harness.php.pendingChanges.current[key]).toBe(pendingDocument);
    expect(harness.php.changeTimers.current[key]).toBe(timer);
    expect(harness.phpGateway.didChange).not.toHaveBeenCalled();
    expect(harness.phpGateway.didSave).not.toHaveBeenCalled();
  });

  it("flushes PHP edits, converges to transformed saved content, then saves", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const editedDocument = phpDocument({ content: "echo  1;" });
    const savedDocument = phpDocument({ content: "echo 1;" });
    const events: string[] = [];
    vi.mocked(harness.phpGateway.didChange).mockImplementation(
      async (_root, document) => {
        events.push(`didChange:${document.version}:${document.text}`);
      },
    );
    vi.mocked(harness.phpGateway.didSave).mockImplementation(
      async (_root, document) => {
        events.push(`didSave:${document.version}:${document.text}`);
      },
    );

    await api().syncOpenDocument(phpDocument({ content: "a" }));
    api().scheduleDocumentChange(editedDocument);
    await api().syncSavedDocument(ROOT, savedDocument);

    expect(events).toEqual([
      "didChange:2:echo  1;",
      "didChange:3:echo 1;",
      "didSave:3:echo 1;",
    ]);
    expect(
      harness.php.syncedContent.current[
        languageServerDocumentSyncKey(ROOT, savedDocument.path)
      ],
    ).toBe("echo 1;");
  });

  it("retries PHP convergence after didChange rejects without poisoning cached state", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const originalDocument = phpDocument({ content: "unformatted" });
    const savedDocument = phpDocument({ content: "formatted" });
    const syncKey = languageServerDocumentSyncKey(ROOT, savedDocument.path);
    const uriKey = languageServerUriSyncKey(
      ROOT,
      fileUriFromPath(savedDocument.path),
    );
    vi.mocked(harness.phpGateway.didChange).mockRejectedValueOnce(
      new Error("didChange failed"),
    );

    await api().syncOpenDocument(originalDocument);
    await api().syncSavedDocument(ROOT, savedDocument);

    expect(harness.phpGateway.didSave).not.toHaveBeenCalled();
    expect(harness.php.syncedContent.current[syncKey]).toBe("unformatted");
    expect(harness.php.versions.current[syncKey]).toBe(3);
    expect(harness.php.versionsByUri.current[uriKey]).toBe(3);

    await api().syncSavedDocument(ROOT, savedDocument);

    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(2);
    expect(harness.phpGateway.didChange).toHaveBeenNthCalledWith(1, ROOT, {
      languageId: "php",
      path: savedDocument.path,
      text: "formatted",
      version: 2,
    }, SESSION);
    expect(harness.phpGateway.didChange).toHaveBeenNthCalledWith(2, ROOT, {
      languageId: "php",
      path: savedDocument.path,
      text: "formatted",
      version: 3,
    }, SESSION);
    expect(harness.phpGateway.didSave).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ text: "formatted", version: 3 }),
      SESSION,
    );
    expect(harness.php.syncedContent.current[syncKey]).toBe("formatted");
    expect(harness.php.versions.current[syncKey]).toBe(3);
    expect(harness.php.versionsByUri.current[uriKey]).toBe(3);
  });

  it("corrects rejected PHP convergence when the editor returns to cached content", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const originalDocument = phpDocument({ content: "a" });
    const convergedDocument = phpDocument({ content: "b" });
    const events: string[] = [];
    vi.mocked(harness.phpGateway.didChange)
      .mockImplementationOnce(async (_root, document) => {
        events.push(`didChange:${document.version}:${document.text}:rejected`);
        throw new Error("delivery uncertain");
      })
      .mockImplementation(async (_root, document) => {
        events.push(`didChange:${document.version}:${document.text}`);
      });
    vi.mocked(harness.phpGateway.didSave).mockImplementation(
      async (_root, document) => {
        events.push(`didSave:${document.version}:${document.text}`);
      },
    );

    await api().syncOpenDocument(originalDocument);
    await api().syncSavedDocument(ROOT, convergedDocument);
    api().scheduleDocumentChange(originalDocument);
    await api().syncSavedDocument(ROOT, originalDocument);

    expect(events).toEqual([
      "didChange:2:b:rejected",
      "didChange:4:a",
      "didSave:4:a",
    ]);
  });

  it("reserves a PHP convergence version before a concurrent edit", async () => {
    const harness = createHarness();
    const convergence = deferred<void>();
    vi.mocked(harness.phpGateway.didChange).mockImplementationOnce(
      async () => convergence.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const originalDocument = phpDocument({ content: "unformatted" });
    const savedDocument = phpDocument({ content: "formatted" });
    const newerDocument = phpDocument({ content: "formatted later" });
    const syncKey = languageServerDocumentSyncKey(ROOT, savedDocument.path);

    await api().syncOpenDocument(originalDocument);
    const save = api().syncSavedDocument(ROOT, savedDocument);
    await flushMicrotasks();

    api().scheduleDocumentChange(newerDocument);
    await vi.advanceTimersByTimeAsync(150);
    convergence.resolve();
    await save;
    await flushMicrotasks();

    expect(harness.phpGateway.didChange).toHaveBeenNthCalledWith(1, ROOT, {
      languageId: "php",
      path: savedDocument.path,
      text: "formatted",
      version: 2,
    }, SESSION);
    expect(harness.phpGateway.didChange).toHaveBeenNthCalledWith(2, ROOT, {
      languageId: "php",
      path: newerDocument.path,
      text: "formatted later",
      version: 3,
    }, SESSION);
    expect(harness.phpGateway.didSave).not.toHaveBeenCalled();
    expect(harness.php.versions.current[syncKey]).toBe(3);
    expect(harness.php.syncedContent.current[syncKey]).toBe("formatted later");
  });

  it("suppresses PHP didSave after an A to B to A generation change", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument({ content: "ab" });
    let releaseDidChange: (() => void) | undefined;
    vi.mocked(harness.phpGateway.didChange).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseDidChange = resolve;
        }),
    );

    await api().syncOpenDocument(phpDocument({ content: "a" }));
    api().scheduleDocumentChange(document);
    const save = api().syncSavedDocument(ROOT, document);
    await flushMicrotasks();
    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(1);

    harness.currentRootRef.current = OTHER_ROOT;
    harness.php.generation.current += 1;
    harness.currentRootRef.current = ROOT;
    releaseDidChange?.();
    await save;

    expect(harness.phpGateway.didSave).not.toHaveBeenCalled();
  });

  it("suppresses PHP convergence and save when shouldEmit becomes stale", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const savedDocument = phpDocument({ content: "saved bytes" });
    const newerDocument = phpDocument({ content: "typed later" });
    const events: string[] = [];
    let shouldEmit = true;
    vi.mocked(harness.phpGateway.didChange).mockImplementation(
      async (_root, document) => {
        events.push(`didChange:${document.text}`);
        shouldEmit = false;
      },
    );
    vi.mocked(harness.phpGateway.didSave).mockImplementation(
      async (_root, document) => {
        events.push(`didSave:${document.text}`);
      },
    );

    await api().syncOpenDocument(savedDocument);
    api().scheduleDocumentChange(newerDocument);
    await api().syncSavedDocument(ROOT, savedDocument, () => shouldEmit);
    await flushMicrotasks();

    expect(events).toEqual(["didChange:typed later"]);
    expect(harness.phpGateway.didSave).not.toHaveBeenCalled();
  });

  it("suppresses PHP didSave when convergence is interrupted by close and reopen", async () => {
    const harness = createHarness();
    const convergence = deferred<void>();
    vi.mocked(harness.phpGateway.didChange).mockImplementation(
      async () => convergence.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const original = phpDocument({ content: "unformatted" });
    const formatted = phpDocument({ content: "formatted" });
    const reopened = phpDocument({ content: "reopened" });
    const fresh = phpDocument({ content: "fresh" });
    const syncKey = languageServerDocumentSyncKey(ROOT, formatted.path);

    await api().syncOpenDocument(original);
    const save = api().syncSavedDocument(ROOT, formatted);
    await flushMicrotasks();
    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(1);

    const close = api().syncClosedDocument(formatted);
    const reopen = api().syncOpenDocument(reopened);
    api().scheduleDocumentChange(fresh);
    convergence.resolve();
    await Promise.all([save, close, reopen]);

    expect(harness.phpGateway.didSave).not.toHaveBeenCalled();
    expect(harness.phpGateway.didClose).toHaveBeenCalledTimes(1);
    expect(harness.phpGateway.didOpen).toHaveBeenCalledTimes(2);
    expect(harness.php.syncedContent.current[syncKey]).toBe("reopened");
    expect(harness.php.pendingChanges.current[syncKey]).toEqual(
      expect.objectContaining({ text: "fresh", version: 2 }),
    );
  });

  it("closes a document, sends didClose, and clears its synced state", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument({ content: "a" });
    const key = languageServerDocumentSyncKey(ROOT, document.path);

    await api().syncOpenDocument(document);
    expect(api().isLanguageServerDocumentSynced(document.path)).toBe(true);

    await api().syncClosedDocument(document);
    await flushMicrotasks();

    expect(harness.phpGateway.didClose).toHaveBeenCalledWith(
      ROOT,
      document.path,
      SESSION,
    );
    expect(harness.php.syncedPaths.current.has(key)).toBe(false);
    expect(harness.php.versions.current[key]).toBeUndefined();
    expect(api().isLanguageServerDocumentSynced(document.path)).toBe(false);
  });

  it("binds a queued stale close to the old session before reopening on its replacement", async () => {
    const harness = createHarness();
    const change = deferred<void>();
    vi.mocked(harness.phpGateway.didChange).mockImplementationOnce(
      async () => change.promise,
    );
    const rendered = renderDocumentSync(harness.deps);
    const { api } = rendered;
    const original = phpDocument({ content: "a" });
    const edited = phpDocument({ content: "ab" });
    const replacement = phpDocument({ content: "replacement" });

    await api().syncOpenDocument(original);
    api().scheduleDocumentChange(edited);
    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    const close = api().syncClosedDocument(edited);
    const replacementStatus = runningStatus(ROOT, SESSION + 1);
    harness.php.statusRef.current = replacementStatus;
    harness.php.statusByRootRef.current = { [ROOT]: replacementStatus };
    harness.deps.languageServerRuntimeStatus = replacementStatus;
    rendered.rerender(harness.deps);
    const reopen = api().syncOpenDocument(replacement);

    change.resolve();
    await Promise.all([close, reopen]);

    expect(harness.phpGateway.didClose).toHaveBeenCalledWith(
      ROOT,
      original.path,
      SESSION,
    );
    expect(harness.phpGateway.didOpen).toHaveBeenLastCalledWith(
      ROOT,
      expect.objectContaining({ path: replacement.path, text: "replacement" }),
      SESSION + 1,
    );
    expect(api().isLanguageServerDocumentSynced(replacement.path)).toBe(true);
  });

  it("drops a debounced didChange when the workspace root changed mid-flight", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);

    await api().syncOpenDocument(phpDocument({ content: "a" }));
    api().scheduleDocumentChange(phpDocument({ content: "ab" }));

    // Tab switch before the debounce fires: the captured root no longer matches.
    harness.currentRootRef.current = OTHER_ROOT;

    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    expect(harness.phpGateway.didChange).not.toHaveBeenCalled();
  });

  it("keeps versions monotonic across a fast edit / flush / edit race", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const path = phpDocument().path;

    await api().syncOpenDocument(phpDocument({ content: "a" }));

    api().scheduleDocumentChange(phpDocument({ content: "ab" }));
    const flush = api().flushPendingDocumentChange(path);
    api().scheduleDocumentChange(phpDocument({ content: "abcd" }));
    await flush;
    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    const versions = vi
      .mocked(harness.phpGateway.didChange)
      .mock.calls.map((call) => call[1].version);
    // Every didChange must carry a strictly increasing version (no desync).
    const sorted = [...versions].sort((left, right) => left - right);
    expect(versions).toEqual(sorted);
    expect(new Set(versions).size).toBe(versions.length);
    // The last change delivered must be the freshest content.
    const calls = vi.mocked(harness.phpGateway.didChange).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[1].text).toBe("abcd");
  });
});

describe("useDocumentSync - JavaScript/TypeScript (tsserver) family", () => {
  it("opens a syncable document with version 1 (no PHP warm-up)", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = tsDocument({ content: "a" });

    await api().syncOpenJavaScriptTypeScriptDocument(document);

    const key = languageServerDocumentSyncKey(ROOT, document.path);
    expect(harness.jstsGateway.didOpen).toHaveBeenCalledWith(ROOT, {
      languageId: "typescript",
      path: document.path,
      text: "a",
      version: 1,
    });
    expect(harness.jsts.syncedPaths.current.has(key)).toBe(true);
    expect(harness.warmUp).not.toHaveBeenCalled();
  });

  it("debounces edits and flushes / saves / closes symmetrically to PHP", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const path = tsDocument().path;
    const key = languageServerDocumentSyncKey(ROOT, path);

    await api().syncOpenJavaScriptTypeScriptDocument(tsDocument({ content: "a" }));

    api().scheduleJavaScriptTypeScriptDocumentChange(tsDocument({ content: "ab" }));
    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();
    expect(harness.jstsGateway.didChange).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ text: "ab", version: 2 }),
    );

    await api().syncSavedJavaScriptTypeScriptDocument(
      ROOT,
      tsDocument({ content: "ab" }),
    );
    await flushMicrotasks();
    expect(harness.jstsGateway.didSave).toHaveBeenCalledTimes(1);
    expect(harness.jstsGateway.didChange).toHaveBeenCalledTimes(1);

    await api().syncClosedJavaScriptTypeScriptDocument(tsDocument({ content: "ab" }));
    await flushMicrotasks();
    expect(harness.jstsGateway.didClose).toHaveBeenCalledWith(ROOT, path);
    expect(harness.jsts.syncedPaths.current.has(key)).toBe(false);
  });

  it("does not let a deferred debounced JavaScript/TypeScript didChange complete into a reopened lifecycle", async () => {
    const harness = createHarness();
    const change = deferred<void>();
    vi.mocked(harness.jstsGateway.didChange).mockImplementationOnce(
      async () => change.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const staleDocument = tsDocument({ content: "stale" });
    const reopenedDocument = tsDocument({ content: "reopened" });
    const freshDocument = tsDocument({ content: "fresh" });
    const syncKey = languageServerDocumentSyncKey(ROOT, staleDocument.path);

    await api().syncOpenJavaScriptTypeScriptDocument(
      tsDocument({ content: "original" }),
    );
    api().scheduleJavaScriptTypeScriptDocumentChange(staleDocument);
    await vi.advanceTimersByTimeAsync(150);
    expect(harness.jstsGateway.didChange).toHaveBeenCalledTimes(1);

    const close = api().syncClosedJavaScriptTypeScriptDocument(staleDocument);
    const reopen = api().syncOpenJavaScriptTypeScriptDocument(reopenedDocument);
    api().scheduleJavaScriptTypeScriptDocumentChange(freshDocument);
    change.resolve();
    await Promise.all([close, reopen]);

    expect(harness.jsts.syncedContent.current[syncKey]).toBe("reopened");
    expect(harness.jsts.pendingChanges.current[syncKey]).toEqual(
      expect.objectContaining({ text: "fresh", version: 2 }),
    );

    await api().flushPendingJavaScriptTypeScriptDocumentChange(
      freshDocument.path,
    );
    expect(harness.jsts.syncedContent.current[syncKey]).toBe("fresh");
    expect(harness.jsts.pendingChanges.current[syncKey]).toBeUndefined();
  });

  it("does not let a deferred explicit JavaScript/TypeScript flush complete into a reopened lifecycle", async () => {
    const harness = createHarness();
    const change = deferred<void>();
    vi.mocked(harness.jstsGateway.didChange).mockImplementationOnce(
      async () => change.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const staleDocument = tsDocument({ content: "stale" });
    const reopenedDocument = tsDocument({ content: "reopened" });
    const freshDocument = tsDocument({ content: "fresh" });
    const syncKey = languageServerDocumentSyncKey(ROOT, staleDocument.path);

    await api().syncOpenJavaScriptTypeScriptDocument(
      tsDocument({ content: "original" }),
    );
    api().scheduleJavaScriptTypeScriptDocumentChange(staleDocument);
    const flush = api().flushPendingJavaScriptTypeScriptDocumentChange(
      staleDocument.path,
    );
    await flushMicrotasks();
    expect(harness.jstsGateway.didChange).toHaveBeenCalledTimes(1);

    const close = api().syncClosedJavaScriptTypeScriptDocument(staleDocument);
    const reopen = api().syncOpenJavaScriptTypeScriptDocument(reopenedDocument);
    api().scheduleJavaScriptTypeScriptDocumentChange(freshDocument);
    change.resolve();
    await Promise.all([flush, close, reopen]);

    expect(harness.jsts.syncedContent.current[syncKey]).toBe("reopened");
    expect(harness.jsts.pendingChanges.current[syncKey]).toEqual(
      expect.objectContaining({ text: "fresh", version: 2 }),
    );

    await api().flushPendingJavaScriptTypeScriptDocumentChange(
      freshDocument.path,
    );
    expect(harness.jsts.syncedContent.current[syncKey]).toBe("fresh");
    expect(harness.jsts.pendingChanges.current[syncKey]).toBeUndefined();
  });

  it("retains a failed JavaScript/TypeScript pending change for a monotonic save retry", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const originalDocument = tsDocument({ content: "a" });
    const editedDocument = tsDocument({ content: "ab" });
    const syncKey = languageServerDocumentSyncKey(ROOT, editedDocument.path);
    vi.mocked(harness.jstsGateway.didChange).mockRejectedValueOnce(
      new Error("didChange failed"),
    );

    await api().syncOpenJavaScriptTypeScriptDocument(originalDocument);
    api().scheduleJavaScriptTypeScriptDocumentChange(editedDocument);
    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    expect(harness.jstsGateway.didChange).toHaveBeenNthCalledWith(1, ROOT, {
      languageId: "typescript",
      path: editedDocument.path,
      text: "ab",
      version: 2,
    });
    expect(harness.jsts.syncedContent.current[syncKey]).toBe("a");
    expect(harness.jsts.pendingChanges.current[syncKey]).toEqual(
      expect.objectContaining({ text: "ab", version: 3 }),
    );

    await api().syncSavedJavaScriptTypeScriptDocument(ROOT, editedDocument);

    expect(harness.jstsGateway.didChange).toHaveBeenNthCalledWith(2, ROOT, {
      languageId: "typescript",
      path: editedDocument.path,
      text: "ab",
      version: 3,
    });
    expect(harness.jstsGateway.didSave).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ text: "ab", version: 3 }),
    );
    expect(harness.jsts.syncedContent.current[syncKey]).toBe("ab");
    expect(harness.jsts.pendingChanges.current[syncKey]).toBeUndefined();
    expect(harness.jsts.versions.current[syncKey]).toBe(3);
  });

  it("does not mutate pending state or save for a mismatched explicit root", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = tsDocument({ content: "ab" });
    const key = languageServerDocumentSyncKey(ROOT, document.path);

    await api().syncOpenJavaScriptTypeScriptDocument(tsDocument({ content: "a" }));
    api().scheduleJavaScriptTypeScriptDocumentChange(document);
    const pendingDocument = harness.jsts.pendingChanges.current[key];
    const timer = harness.jsts.changeTimers.current[key];

    await api().flushPendingJavaScriptTypeScriptDocumentChangeForRoot(
      OTHER_ROOT,
      document.path,
    );
    await api().syncSavedJavaScriptTypeScriptDocument(OTHER_ROOT, document);

    expect(harness.jsts.pendingChanges.current[key]).toBe(pendingDocument);
    expect(harness.jsts.changeTimers.current[key]).toBe(timer);
    expect(harness.jstsGateway.didChange).not.toHaveBeenCalled();
    expect(harness.jstsGateway.didSave).not.toHaveBeenCalled();
  });

  it("flushes JavaScript/TypeScript edits, converges to transformed saved content, then saves", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const editedDocument = tsDocument({ content: "const x=1" });
    const savedDocument = tsDocument({ content: "const x = 1;" });
    const events: string[] = [];
    vi.mocked(harness.jstsGateway.didChange).mockImplementation(
      async (_root, document) => {
        events.push(`didChange:${document.version}:${document.text}`);
      },
    );
    vi.mocked(harness.jstsGateway.didSave).mockImplementation(
      async (_root, document) => {
        events.push(`didSave:${document.version}:${document.text}`);
      },
    );

    await api().syncOpenJavaScriptTypeScriptDocument(tsDocument({ content: "a" }));
    api().scheduleJavaScriptTypeScriptDocumentChange(editedDocument);
    await api().syncSavedJavaScriptTypeScriptDocument(ROOT, savedDocument);

    expect(events).toEqual([
      "didChange:2:const x=1",
      "didChange:3:const x = 1;",
      "didSave:3:const x = 1;",
    ]);
    expect(
      harness.jsts.syncedContent.current[
        languageServerDocumentSyncKey(ROOT, savedDocument.path)
      ],
    ).toBe("const x = 1;");
  });

  it("retries JavaScript/TypeScript convergence after didChange rejects without poisoning cached state", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const originalDocument = tsDocument({ content: "unformatted" });
    const savedDocument = tsDocument({ content: "formatted" });
    const syncKey = languageServerDocumentSyncKey(ROOT, savedDocument.path);
    const uriKey = languageServerUriSyncKey(
      ROOT,
      fileUriFromPath(savedDocument.path),
    );
    vi.mocked(harness.jstsGateway.didChange).mockRejectedValueOnce(
      new Error("didChange failed"),
    );

    await api().syncOpenJavaScriptTypeScriptDocument(originalDocument);
    await api().syncSavedJavaScriptTypeScriptDocument(ROOT, savedDocument);

    expect(harness.jstsGateway.didSave).not.toHaveBeenCalled();
    expect(harness.jsts.syncedContent.current[syncKey]).toBe("unformatted");
    expect(harness.jsts.versions.current[syncKey]).toBe(3);
    expect(harness.jsts.versionsByUri.current[uriKey]).toBe(3);

    await api().syncSavedJavaScriptTypeScriptDocument(ROOT, savedDocument);

    expect(harness.jstsGateway.didChange).toHaveBeenCalledTimes(2);
    expect(harness.jstsGateway.didChange).toHaveBeenNthCalledWith(1, ROOT, {
      languageId: "typescript",
      path: savedDocument.path,
      text: "formatted",
      version: 2,
    });
    expect(harness.jstsGateway.didChange).toHaveBeenNthCalledWith(2, ROOT, {
      languageId: "typescript",
      path: savedDocument.path,
      text: "formatted",
      version: 3,
    });
    expect(harness.jstsGateway.didSave).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ text: "formatted", version: 3 }),
    );
    expect(harness.jsts.syncedContent.current[syncKey]).toBe("formatted");
    expect(harness.jsts.versions.current[syncKey]).toBe(3);
    expect(harness.jsts.versionsByUri.current[uriKey]).toBe(3);
  });

  it("corrects rejected JavaScript/TypeScript convergence when the editor returns to cached content", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const originalDocument = tsDocument({ content: "a" });
    const convergedDocument = tsDocument({ content: "b" });
    const events: string[] = [];
    vi.mocked(harness.jstsGateway.didChange)
      .mockImplementationOnce(async (_root, document) => {
        events.push(`didChange:${document.version}:${document.text}:rejected`);
        throw new Error("delivery uncertain");
      })
      .mockImplementation(async (_root, document) => {
        events.push(`didChange:${document.version}:${document.text}`);
      });
    vi.mocked(harness.jstsGateway.didSave).mockImplementation(
      async (_root, document) => {
        events.push(`didSave:${document.version}:${document.text}`);
      },
    );

    await api().syncOpenJavaScriptTypeScriptDocument(originalDocument);
    await api().syncSavedJavaScriptTypeScriptDocument(ROOT, convergedDocument);
    api().scheduleJavaScriptTypeScriptDocumentChange(originalDocument);
    await api().syncSavedJavaScriptTypeScriptDocument(ROOT, originalDocument);

    expect(events).toEqual([
      "didChange:2:b:rejected",
      "didChange:4:a",
      "didSave:4:a",
    ]);
  });

  it("reserves a JavaScript/TypeScript convergence version before a concurrent edit", async () => {
    const harness = createHarness();
    const convergence = deferred<void>();
    vi.mocked(harness.jstsGateway.didChange).mockImplementationOnce(
      async () => convergence.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const originalDocument = tsDocument({ content: "unformatted" });
    const savedDocument = tsDocument({ content: "formatted" });
    const newerDocument = tsDocument({ content: "formatted later" });
    const syncKey = languageServerDocumentSyncKey(ROOT, savedDocument.path);

    await api().syncOpenJavaScriptTypeScriptDocument(originalDocument);
    const save = api().syncSavedJavaScriptTypeScriptDocument(
      ROOT,
      savedDocument,
    );
    await flushMicrotasks();

    api().scheduleJavaScriptTypeScriptDocumentChange(newerDocument);
    await vi.advanceTimersByTimeAsync(150);
    convergence.resolve();
    await save;
    await flushMicrotasks();

    expect(harness.jstsGateway.didChange).toHaveBeenNthCalledWith(1, ROOT, {
      languageId: "typescript",
      path: savedDocument.path,
      text: "formatted",
      version: 2,
    });
    expect(harness.jstsGateway.didChange).toHaveBeenNthCalledWith(2, ROOT, {
      languageId: "typescript",
      path: newerDocument.path,
      text: "formatted later",
      version: 3,
    });
    expect(harness.jstsGateway.didSave).not.toHaveBeenCalled();
    expect(harness.jsts.versions.current[syncKey]).toBe(3);
    expect(harness.jsts.syncedContent.current[syncKey]).toBe("formatted later");
  });

  it("suppresses JavaScript/TypeScript didSave after an A to B to A generation change", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = tsDocument({ content: "ab" });
    let releaseDidChange: (() => void) | undefined;
    vi.mocked(harness.jstsGateway.didChange).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseDidChange = resolve;
        }),
    );

    await api().syncOpenJavaScriptTypeScriptDocument(tsDocument({ content: "a" }));
    api().scheduleJavaScriptTypeScriptDocumentChange(document);
    const save = api().syncSavedJavaScriptTypeScriptDocument(ROOT, document);
    await flushMicrotasks();
    expect(harness.jstsGateway.didChange).toHaveBeenCalledTimes(1);

    harness.currentRootRef.current = OTHER_ROOT;
    harness.jsts.generation.current += 1;
    harness.currentRootRef.current = ROOT;
    releaseDidChange?.();
    await save;

    expect(harness.jstsGateway.didSave).not.toHaveBeenCalled();
  });

  it("suppresses JavaScript/TypeScript didSave after a session restart during convergence", async () => {
    const harness = createHarness();
    const convergence = deferred<void>();
    vi.mocked(harness.jstsGateway.didChange).mockImplementation(
      async () => convergence.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const savedDocument = tsDocument({ content: "formatted" });

    await api().syncOpenJavaScriptTypeScriptDocument(
      tsDocument({ content: "unformatted" }),
    );
    const save = api().syncSavedJavaScriptTypeScriptDocument(
      ROOT,
      savedDocument,
    );
    await flushMicrotasks();
    expect(harness.jstsGateway.didChange).toHaveBeenCalledTimes(1);

    const replacementSession = runningStatus(ROOT, SESSION + 1);
    harness.jsts.statusRef.current = replacementSession;
    harness.jsts.statusByRootRef.current = { [ROOT]: replacementSession };
    convergence.resolve();
    await save;

    expect(harness.jstsGateway.didSave).not.toHaveBeenCalled();
  });

  it("suppresses JavaScript/TypeScript didSave when convergence is interrupted by close and reopen", async () => {
    const harness = createHarness();
    const convergence = deferred<void>();
    vi.mocked(harness.jstsGateway.didChange).mockImplementation(
      async () => convergence.promise,
    );
    const { api } = renderDocumentSync(harness.deps);
    const original = tsDocument({ content: "unformatted" });
    const formatted = tsDocument({ content: "formatted" });
    const reopened = tsDocument({ content: "reopened" });
    const fresh = tsDocument({ content: "fresh" });
    const syncKey = languageServerDocumentSyncKey(ROOT, formatted.path);

    await api().syncOpenJavaScriptTypeScriptDocument(original);
    const save = api().syncSavedJavaScriptTypeScriptDocument(ROOT, formatted);
    await flushMicrotasks();
    expect(harness.jstsGateway.didChange).toHaveBeenCalledTimes(1);

    const close = api().syncClosedJavaScriptTypeScriptDocument(formatted);
    const reopen = api().syncOpenJavaScriptTypeScriptDocument(reopened);
    api().scheduleJavaScriptTypeScriptDocumentChange(fresh);
    convergence.resolve();
    await Promise.all([save, close, reopen]);

    expect(harness.jstsGateway.didSave).not.toHaveBeenCalled();
    expect(harness.jstsGateway.didClose).toHaveBeenCalledTimes(1);
    expect(harness.jstsGateway.didOpen).toHaveBeenCalledTimes(2);
    expect(harness.jsts.syncedContent.current[syncKey]).toBe("reopened");
    expect(harness.jsts.pendingChanges.current[syncKey]).toEqual(
      expect.objectContaining({ text: "fresh", version: 2 }),
    );
  });

  it("does not sync a document outside the workspace root", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const outside = tsDocument({ path: "/elsewhere/lib.ts" });

    await api().syncOpenJavaScriptTypeScriptDocument(outside);

    expect(harness.jstsGateway.didOpen).not.toHaveBeenCalled();
  });
});

describe("useDocumentSync - cross-family isolation", () => {
  it("closing all synced PHP documents for a root sends didClose per document and resets", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const first = phpDocument({ path: `${ROOT}/app/A.php` });
    const second = phpDocument({ path: `${ROOT}/app/B.php` });

    await api().syncOpenDocument(first);
    await api().syncOpenDocument(second);

    await api().closeSyncedLanguageServerDocumentsForRoot(ROOT);
    await flushMicrotasks();

    expect(harness.phpGateway.didClose).toHaveBeenCalledWith(
      ROOT,
      first.path,
      SESSION,
    );
    expect(harness.phpGateway.didClose).toHaveBeenCalledWith(
      ROOT,
      second.path,
      SESSION,
    );
    expect(harness.php.syncedPaths.current.size).toBe(0);
  });

  it("a PHP document is never opened on the JavaScript/TypeScript server", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument();

    await api().syncOpenDocument(document);
    await api().syncOpenJavaScriptTypeScriptDocument(document);

    expect(harness.phpGateway.didOpen).toHaveBeenCalledTimes(1);
    expect(harness.jstsGateway.didOpen).not.toHaveBeenCalled();
  });
});
