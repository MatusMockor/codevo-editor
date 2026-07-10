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
  type LanguageServerDocumentSyncGateway,
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

function createSyncGatewaySpy(): LanguageServerDocumentSyncGateway {
  return {
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
  phpGateway: LanguageServerDocumentSyncGateway;
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
    });
    expect(harness.php.syncedPaths.current.has(key)).toBe(true);
    expect(harness.warmUp).toHaveBeenCalledWith(ROOT, document.path, SESSION);
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
    });
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
    );

    // The debounce timer was cancelled by the flush: advancing it sends nothing.
    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();
    expect(harness.phpGateway.didChange).toHaveBeenCalledTimes(1);
  });

  it("saves a document with its current version after flushing pending changes", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const document = phpDocument({ content: "a" });

    await api().syncOpenDocument(document);
    await api().syncSavedDocument(document);
    await flushMicrotasks();

    expect(harness.phpGateway.didSave).toHaveBeenCalledTimes(1);
    expect(harness.phpGateway.didSave).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ path: document.path, version: 1 }),
    );
  });

  it("emits a newer didChange but suppresses stale didSave after the flush", async () => {
    const harness = createHarness();
    const { api } = renderDocumentSync(harness.deps);
    const savedDocument = phpDocument({ content: "saved bytes" });
    const newerDocument = phpDocument({ content: "typed later" });
    const events: string[] = [];
    vi.mocked(harness.phpGateway.didChange).mockImplementation(
      async (_root, document) => {
        events.push(`didChange:${document.text}`);
      },
    );
    vi.mocked(harness.phpGateway.didSave).mockImplementation(
      async (_root, document) => {
        events.push(`didSave:${document.text}`);
      },
    );

    await api().syncOpenDocument(savedDocument);
    api().scheduleDocumentChange(newerDocument);
    await api().syncSavedDocument(savedDocument, () => true);
    await flushMicrotasks();

    expect(events).toEqual(["didChange:typed later"]);
    expect(harness.phpGateway.didSave).not.toHaveBeenCalled();
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

    expect(harness.phpGateway.didClose).toHaveBeenCalledWith(ROOT, document.path);
    expect(harness.php.syncedPaths.current.has(key)).toBe(false);
    expect(harness.php.versions.current[key]).toBeUndefined();
    expect(api().isLanguageServerDocumentSynced(document.path)).toBe(false);
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

    await api().syncSavedJavaScriptTypeScriptDocument(tsDocument({ content: "ab" }));
    await flushMicrotasks();
    expect(harness.jstsGateway.didSave).toHaveBeenCalledTimes(1);

    await api().syncClosedJavaScriptTypeScriptDocument(tsDocument({ content: "ab" }));
    await flushMicrotasks();
    expect(harness.jstsGateway.didClose).toHaveBeenCalledWith(ROOT, path);
    expect(harness.jsts.syncedPaths.current.has(key)).toBe(false);
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

    expect(harness.phpGateway.didClose).toHaveBeenCalledWith(ROOT, first.path);
    expect(harness.phpGateway.didClose).toHaveBeenCalledWith(ROOT, second.path);
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
