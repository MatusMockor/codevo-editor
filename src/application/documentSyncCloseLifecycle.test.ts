import { describe, expect, it, vi } from "vitest";
import {
  languageServerDocumentSyncKey,
  sessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import {
  closeJavaScriptTypeScriptDocumentsForRoot,
  closePhpDocumentsForRoot,
} from "./documentSyncCloseLifecycle";

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const SESSION = 41;

function ref<T>(current: T): { current: T } {
  return { current };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function running(rootPath: string, sessionId: number): LanguageServerRuntimeStatus {
  return {
    capabilities: {},
    kind: "running",
    rootPath,
    sessionId,
  } as LanguageServerRuntimeStatus;
}

function isRunningForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  _statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  return status?.kind === "running" && status.rootPath === workspaceRoot;
}

function versionState(key: string) {
  return {
    diagnosticVersionsByUriRef: ref<Record<string, number>>({}),
    documentVersionsByUriRef: ref<Record<string, number>>({}),
    documentVersionsRef: ref<Record<string, number>>({ [key]: 1 }),
  };
}

describe("document sync root-close lifecycle", () => {
  it("clears only the requested PHP root and binds didClose to its cached session", async () => {
    const path = `${ROOT}/src/User.php`;
    const otherPath = `${OTHER_ROOT}/src/Other.php`;
    const key = languageServerDocumentSyncKey(ROOT, path);
    const otherKey = languageServerDocumentSyncKey(OTHER_ROOT, otherPath);
    const syncedPathsRef = ref(new Set([key, otherKey]));
    const lifecycleIdentitiesRef = ref<Record<string, number>>({ [key]: 7, [otherKey]: 8 });
    const syncedContentRef = ref<Record<string, string>>({ [key]: "a", [otherKey]: "b" });
    const pendingChangesRef = ref({ [key]: { languageId: "php", path, text: "a", version: 2 } });
    const pendingOpenAttemptsRef = ref<Record<string, number>>({ [key]: 3 });
    const pendingLifecycleIdentitiesRef = ref<Record<string, number>>({ [key]: 7 });
    const syncGenerationRef = ref(10);
    const didClose = vi.fn(async () => undefined);
    const resetDocuments = vi.fn();

    await closePhpDocumentsForRoot({
      rootPath: ROOT,
      syncGenerationRef,
      state: {
        syncedPathsRef,
        syncedContentRef,
        pendingChangesRef,
        pendingOpenAttemptsRef,
        lifecycleIdentitiesRef,
        pendingLifecycleIdentitiesRef,
        versionState: versionState(key),
      },
      runtimeAuthority: {
        statusRef: ref(running(OTHER_ROOT, 90)),
        statusRootRef: ref(OTHER_ROOT),
        statusByRootRef: ref({ [ROOT]: running(ROOT, SESSION) }),
        isRunningForWorkspace,
      },
      clearChangeTimer: vi.fn(),
      enqueueSync: async (_syncKey, operation) => operation(),
      gateway: {
        [sessionBoundLanguageServerDocumentSyncGateway]: true,
        didOpen: vi.fn(),
        didChange: vi.fn(),
        didSave: vi.fn(),
        didClose,
      },
      isSessionCurrent: (rootPath, sessionId) => rootPath === ROOT && sessionId === SESSION,
      reportError: vi.fn(),
      resetDocuments,
    });

    expect(syncGenerationRef.current).toBe(11);
    expect(didClose).toHaveBeenCalledWith(ROOT, path, SESSION);
    expect(syncedPathsRef.current).toEqual(new Set([otherKey]));
    expect(lifecycleIdentitiesRef.current).toEqual({ [otherKey]: 8 });
    expect(syncedContentRef.current).toEqual({ [otherKey]: "b" });
    expect(pendingChangesRef.current).toEqual({});
    expect(pendingOpenAttemptsRef.current).toEqual({});
    expect(pendingLifecycleIdentitiesRef.current).toEqual({});
    expect(resetDocuments).not.toHaveBeenCalled();
  });

  it("filters JS/TS paths by exact workspace authority and clears authority versions", async () => {
    const path = `${ROOT}/src/index.ts`;
    const rejectedPath = `${ROOT}/vendor/generated.ts`;
    const key = languageServerDocumentSyncKey(ROOT, path);
    const rejectedKey = languageServerDocumentSyncKey(ROOT, rejectedPath);
    const syncedPathsRef = ref(new Set([key, rejectedKey]));
    const lifecycleIdentitiesRef = ref<Record<string, number>>({ [key]: 2, [rejectedKey]: 3 });
    const authorityVersionsRef = ref<Record<string, number>>({ [key]: 20, [rejectedKey]: 30 });
    const didClose = vi.fn(async () => undefined);
    const syncGenerationRef = ref(4);

    await closeJavaScriptTypeScriptDocumentsForRoot({
      rootPath: ROOT,
      syncGenerationRef,
      state: {
        syncedPathsRef,
        syncedContentRef: ref<Record<string, string>>({ [key]: "a", [rejectedKey]: "b" }),
        pendingChangesRef: ref({}),
        pendingOpenAttemptsRef: ref({}),
        lifecycleIdentitiesRef,
        authorityVersionsRef,
        versionState: versionState(key),
      },
      runtimeAuthority: {
        statusRef: ref(running(ROOT, SESSION)),
        statusRootRef: ref(ROOT),
        statusByRootRef: ref({ [ROOT]: running(ROOT, SESSION) }),
        isRunningForWorkspace,
      },
      isPathInWorkspace: (_rootPath, candidatePath) => candidatePath === path,
      clearChangeTimer: vi.fn(),
      enqueueSync: async (_syncKey, operation) => operation(),
      gateway: {
        didOpen: vi.fn(),
        didChange: vi.fn(),
        didSave: vi.fn(),
        didClose,
      },
      isSessionCurrent: (rootPath, sessionId) => rootPath === ROOT && sessionId === SESSION,
      reportError: vi.fn(),
    });

    expect(syncGenerationRef.current).toBe(5);
    expect(didClose).toHaveBeenCalledOnce();
    expect(didClose).toHaveBeenCalledWith(ROOT, path);
    expect(syncedPathsRef.current).toEqual(new Set([rejectedKey]));
    expect(lifecycleIdentitiesRef.current).toEqual({ [rejectedKey]: 3 });
    expect(authorityVersionsRef.current).toEqual({ [rejectedKey]: 30 });
  });

  it("drops a queued JS/TS close after its captured session is replaced", async () => {
    const path = `${ROOT}/src/index.ts`;
    const key = languageServerDocumentSyncKey(ROOT, path);
    const queueAdmission = deferred<void>();
    let currentSessionId = SESSION;
    const didClose = vi.fn(async () => undefined);

    const close = closeJavaScriptTypeScriptDocumentsForRoot({
      rootPath: ROOT,
      syncGenerationRef: ref(0),
      state: {
        syncedPathsRef: ref(new Set([key])),
        syncedContentRef: ref({ [key]: "a" }),
        pendingChangesRef: ref({}),
        pendingOpenAttemptsRef: ref({}),
        lifecycleIdentitiesRef: ref({ [key]: 1 }),
        authorityVersionsRef: ref({ [key]: 1 }),
        versionState: versionState(key),
      },
      runtimeAuthority: {
        statusRef: ref(running(ROOT, SESSION)),
        statusRootRef: ref(ROOT),
        statusByRootRef: ref({ [ROOT]: running(ROOT, SESSION) }),
        isRunningForWorkspace,
      },
      isPathInWorkspace: () => true,
      clearChangeTimer: vi.fn(),
      enqueueSync: async (_syncKey, operation) => {
        await queueAdmission.promise;
        await operation();
      },
      gateway: {
        didOpen: vi.fn(),
        didChange: vi.fn(),
        didSave: vi.fn(),
        didClose,
      },
      isSessionCurrent: (_rootPath, sessionId) => currentSessionId === sessionId,
      reportError: vi.fn(),
    });

    currentSessionId = SESSION + 1;
    queueAdmission.resolve();
    await close;

    expect(didClose).not.toHaveBeenCalled();
  });
});
