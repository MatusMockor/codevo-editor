import { describe, expect, it, vi } from "vitest";
import {
  captureWorkspaceBeforeSwitch,
  closeWorkspaceDocumentsBeforeSwitch,
  type CaptureWorkspaceBeforeSwitchPorts,
  type CloseWorkspaceDocumentsBeforeSwitchPorts,
  WorkspaceDocumentCloseCoordinator,
} from "./workspaceSessionSwitchLifecycle";

const ROOT = "/workspace";

describe("workspace session switch lifecycle", () => {
  it("invalidates pending file open before persisting and caching", async () => {
    const calls: string[] = [];
    const ports = createPorts({
      invalidatePendingFileOpen: () => calls.push("invalidate"),
      persistWorkspaceSession: async (rootPath) => {
        calls.push(`persist:${rootPath}`);
      },
      cacheWorkspaceState: (rootPath) => calls.push(`cache:${rootPath}`),
    });

    const result = await captureWorkspaceBeforeSwitch(
      {
        rootPath: ROOT,
        cacheWorkspace: true,
        isRequestCurrent: () => {
          calls.push("current");
          return true;
        },
      },
      ports,
    );

    expect(result).toBe("continue");
    expect(calls).toEqual([
      "invalidate",
      `persist:${ROOT}`,
      "current",
      `cache:${ROOT}`,
    ]);
  });

  it("reports persistence failures and continues to cache a current request", async () => {
    const error = new Error("persistence failed");
    const calls: string[] = [];
    const reportPersistenceError = vi.fn(
      (rootPath: string, reportedError: unknown) => {
        expect(rootPath).toBe(ROOT);
        expect(reportedError).toBe(error);
        calls.push("report");
      },
    );
    const ports = createPorts({
      invalidatePendingFileOpen: () => calls.push("invalidate"),
      persistWorkspaceSession: async () => {
        calls.push("persist");
        throw error;
      },
      cacheWorkspaceState: () => calls.push("cache"),
      reportPersistenceError,
    });

    await expect(
      captureWorkspaceBeforeSwitch(
        {
          rootPath: ROOT,
          cacheWorkspace: true,
          isRequestCurrent: () => {
            calls.push("current");
            return true;
          },
        },
        ports,
      ),
    ).resolves.toBe("continue");

    expect(reportPersistenceError).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      "invalidate",
      "persist",
      "report",
      "current",
      "cache",
    ]);
  });

  it("reports a rejected persistence request before returning stale", async () => {
    const error = new Error("persistence failed");
    let current = true;
    const ports = createPorts({
      persistWorkspaceSession: async () => {
        current = false;
        throw error;
      },
    });

    await expect(
      captureWorkspaceBeforeSwitch(
        {
          rootPath: ROOT,
          cacheWorkspace: true,
          isRequestCurrent: () => current,
        },
        ports,
      ),
    ).resolves.toBe("stale");

    expect(ports.reportPersistenceError).toHaveBeenCalledOnce();
    expect(ports.reportPersistenceError).toHaveBeenCalledWith(ROOT, error);
    expect(ports.cacheWorkspaceState).not.toHaveBeenCalled();
  });

  it("returns stale without caching when the request changes during persistence", async () => {
    let current = true;
    const ports = createPorts({
      persistWorkspaceSession: async () => {
        current = false;
      },
    });

    await expect(
      captureWorkspaceBeforeSwitch(
        {
          rootPath: ROOT,
          cacheWorkspace: true,
          isRequestCurrent: () => current,
        },
        ports,
      ),
    ).resolves.toBe("stale");

    expect(ports.cacheWorkspaceState).not.toHaveBeenCalled();
  });

  it("only invalidates when workspace caching is disabled", async () => {
    const ports = createPorts();
    const isRequestCurrent = vi.fn(() => false);

    await expect(
      captureWorkspaceBeforeSwitch(
        {
          rootPath: ROOT,
          cacheWorkspace: false,
          isRequestCurrent,
        },
        ports,
      ),
    ).resolves.toBe("continue");

    expect(ports.invalidatePendingFileOpen).toHaveBeenCalledOnce();
    expect(ports.persistWorkspaceSession).not.toHaveBeenCalled();
    expect(ports.reportPersistenceError).not.toHaveBeenCalled();
    expect(isRequestCurrent).not.toHaveBeenCalled();
    expect(ports.cacheWorkspaceState).not.toHaveBeenCalled();
  });
});

describe("closeWorkspaceDocumentsBeforeSwitch", () => {
  it("starts both closes eagerly and waits for both to settle", async () => {
    const languageServerClose = createDeferred<void>();
    const javaScriptTypeScriptClose = createDeferred<void>();
    const isRequestCurrent = vi.fn(() => true);
    const ports = createClosePorts({
      closeLanguageServerDocuments: vi.fn(
        () => languageServerClose.promise,
      ),
      closeJavaScriptTypeScriptDocuments: vi.fn(
        () => javaScriptTypeScriptClose.promise,
      ),
    });

    const result = closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: ROOT, isRequestCurrent },
      ports,
      new WorkspaceDocumentCloseCoordinator(),
    );

    expect(ports.closeLanguageServerDocuments).toHaveBeenCalledWith(ROOT);
    expect(ports.closeJavaScriptTypeScriptDocuments).toHaveBeenCalledWith(ROOT);
    expect(isRequestCurrent).not.toHaveBeenCalled();

    languageServerClose.resolve();
    await Promise.resolve();
    expect(isRequestCurrent).not.toHaveBeenCalled();

    javaScriptTypeScriptClose.resolve();
    await expect(result).resolves.toBe("continue");
  });

  it("coalesces closes for the same root and makes both callers wait", async () => {
    const languageServerClose = createDeferred<void>();
    const javaScriptTypeScriptClose = createDeferred<void>();
    const firstIsCurrent = vi.fn(() => true);
    const secondIsCurrent = vi.fn(() => true);
    const ports = createClosePorts({
      closeLanguageServerDocuments: vi.fn(
        () => languageServerClose.promise,
      ),
      closeJavaScriptTypeScriptDocuments: vi.fn(
        () => javaScriptTypeScriptClose.promise,
      ),
    });
    const coordinator = new WorkspaceDocumentCloseCoordinator();

    const first = closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: ROOT, isRequestCurrent: firstIsCurrent },
      ports,
      coordinator,
    );
    const second = closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: ROOT, isRequestCurrent: secondIsCurrent },
      ports,
      coordinator,
    );

    expect(ports.closeLanguageServerDocuments).toHaveBeenCalledOnce();
    expect(ports.closeJavaScriptTypeScriptDocuments).toHaveBeenCalledOnce();

    languageServerClose.resolve();
    await Promise.resolve();
    expect(firstIsCurrent).not.toHaveBeenCalled();
    expect(secondIsCurrent).not.toHaveBeenCalled();

    javaScriptTypeScriptClose.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "continue",
      "continue",
    ]);
  });

  it("coordinates different roots independently", async () => {
    const otherRoot = "/other-workspace";
    const rootClose = createDeferred<void>();
    const otherRootClose = createDeferred<void>();
    const ports = createClosePorts({
      closeLanguageServerDocuments: vi.fn((rootPath) => {
        if (rootPath === ROOT) {
          return rootClose.promise;
        }

        return otherRootClose.promise;
      }),
    });
    const coordinator = new WorkspaceDocumentCloseCoordinator();
    const rootIsCurrent = vi.fn(() => true);
    const otherRootIsCurrent = vi.fn(() => true);

    const rootResult = closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: ROOT, isRequestCurrent: rootIsCurrent },
      ports,
      coordinator,
    );
    const otherRootResult = closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: otherRoot, isRequestCurrent: otherRootIsCurrent },
      ports,
      coordinator,
    );

    expect(ports.closeLanguageServerDocuments).toHaveBeenCalledTimes(2);
    expect(ports.closeJavaScriptTypeScriptDocuments).toHaveBeenCalledTimes(2);

    rootClose.resolve();
    await expect(rootResult).resolves.toBe("continue");
    expect(rootIsCurrent).toHaveBeenCalledOnce();
    expect(otherRootIsCurrent).not.toHaveBeenCalled();

    otherRootClose.resolve();
    await expect(otherRootResult).resolves.toBe("continue");
  });

  it("cleans up a settled close so a later close can run", async () => {
    const ports = createClosePorts();
    const coordinator = new WorkspaceDocumentCloseCoordinator();

    await closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: ROOT, isRequestCurrent: () => true },
      ports,
      coordinator,
    );
    await closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: ROOT, isRequestCurrent: () => true },
      ports,
      coordinator,
    );

    expect(ports.closeLanguageServerDocuments).toHaveBeenCalledTimes(2);
    expect(ports.closeJavaScriptTypeScriptDocuments).toHaveBeenCalledTimes(2);
  });

  it("absorbs failures from both document closes", async () => {
    const ports = createClosePorts({
      closeLanguageServerDocuments: vi.fn(() => {
        throw new Error("language server close failed");
      }),
      closeJavaScriptTypeScriptDocuments: vi.fn(async () => {
        throw new Error("JavaScript/TypeScript close failed");
      }),
    });

    await expect(
      closeWorkspaceDocumentsBeforeSwitch(
        { rootPath: ROOT, isRequestCurrent: () => true },
        ports,
        new WorkspaceDocumentCloseCoordinator(),
      ),
    ).resolves.toBe("continue");
  });

  it("returns stale when the request is no longer current", async () => {
    await expect(
      closeWorkspaceDocumentsBeforeSwitch(
        { rootPath: ROOT, isRequestCurrent: () => false },
        createClosePorts(),
        new WorkspaceDocumentCloseCoordinator(),
      ),
    ).resolves.toBe("stale");
  });

  it("returns stale and current outcomes per coalesced caller", async () => {
    const close = createDeferred<void>();
    const staleIsCurrent = vi.fn(() => false);
    const currentIsCurrent = vi.fn(() => true);
    const ports = createClosePorts({
      closeLanguageServerDocuments: vi.fn(() => close.promise),
    });
    const coordinator = new WorkspaceDocumentCloseCoordinator();

    const stale = closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: ROOT, isRequestCurrent: staleIsCurrent },
      ports,
      coordinator,
    );
    const current = closeWorkspaceDocumentsBeforeSwitch(
      { rootPath: ROOT, isRequestCurrent: currentIsCurrent },
      ports,
      coordinator,
    );

    close.resolve();

    await expect(Promise.all([stale, current])).resolves.toEqual([
      "stale",
      "continue",
    ]);
    expect(staleIsCurrent).toHaveBeenCalledOnce();
    expect(currentIsCurrent).toHaveBeenCalledOnce();
    expect(ports.closeLanguageServerDocuments).toHaveBeenCalledOnce();
    expect(ports.closeJavaScriptTypeScriptDocuments).toHaveBeenCalledOnce();
  });

  it("checks request freshness exactly once after both closes settle", async () => {
    const calls: string[] = [];
    const isRequestCurrent = vi.fn(() => {
      calls.push("current");
      return true;
    });
    const ports = createClosePorts({
      closeLanguageServerDocuments: vi.fn(async () => {
        calls.push("language-server");
      }),
      closeJavaScriptTypeScriptDocuments: vi.fn(async () => {
        calls.push("javascript-typescript");
      }),
    });

    await expect(
      closeWorkspaceDocumentsBeforeSwitch(
        { rootPath: ROOT, isRequestCurrent },
        ports,
        new WorkspaceDocumentCloseCoordinator(),
      ),
    ).resolves.toBe("continue");

    expect(isRequestCurrent).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      "language-server",
      "javascript-typescript",
      "current",
    ]);
  });
});

function createPorts(
  overrides: Partial<CaptureWorkspaceBeforeSwitchPorts> = {},
): CaptureWorkspaceBeforeSwitchPorts {
  return {
    invalidatePendingFileOpen: vi.fn(),
    persistWorkspaceSession: vi.fn(async () => undefined),
    cacheWorkspaceState: vi.fn(),
    reportPersistenceError: vi.fn(),
    ...overrides,
  };
}

function createClosePorts(
  overrides: Partial<CloseWorkspaceDocumentsBeforeSwitchPorts> = {},
): CloseWorkspaceDocumentsBeforeSwitchPorts {
  return {
    closeLanguageServerDocuments: vi.fn(async () => undefined),
    closeJavaScriptTypeScriptDocuments: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
