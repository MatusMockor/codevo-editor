// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  IndexProgressEvent,
  IndexProgressGateway,
  InitialMetadataScanStart,
  MetadataScanCompletionEvent,
  WorkspaceIndexClearResult,
} from "../domain/indexProgress";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  createIndexOperationGenerationIssuer,
  useWorkbenchIndexLifecycle,
  type WorkbenchIndexLifecycleOptions,
} from "./useWorkbenchIndexLifecycle";

describe("useWorkbenchIndexLifecycle exact request authority", () => {
  it.each(["resolve", "reject"] as const)(
    "suppresses a stale clear %s after an A to B to A replacement",
    async (settlement) => {
      const clear = deferred<WorkspaceIndexClearResult>();
      const gateway = indexGateway({ clearWorkspaceIndex: vi.fn(() => clear.promise) });
      const reportError = vi.fn();
      const setMessage = vi.fn();
      const harness = renderLifecycle(gateway, reportError, setMessage);
      const authorityA = {};
      const replacementA = {};
      let currentAuthority = authorityA;

      let pending = Promise.resolve();
      act(() => {
        pending = harness
          .lifecycle()
          .clearWorkspaceIndex(
            "/workspace",
            "Index cleared.",
            () => currentAuthority === authorityA,
          );
      });
      currentAuthority = {};
      currentAuthority = replacementA;
      if (settlement === "resolve") {
        clear.resolve({
          databasePath: "/workspace/.index",
          rootPath: "/workspace",
          status: "cleared",
        });
      }
      if (settlement === "reject") clear.reject(new Error("stale clear"));
      await act(async () => pending);

      expect(gateway.clearWorkspaceIndex).toHaveBeenCalledWith({
        admissionToken: 11,
        rootPath: "/workspace",
        workspaceId: "workspace-a",
      });
      expect(setMessage).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it.each(["resolve", "reject"] as const)(
    "suppresses a stale scan %s after an A to B to A replacement",
    async (settlement) => {
      const scan = deferred<InitialMetadataScanStart>();
      const gateway = indexGateway({ startInitialMetadataScan: vi.fn(() => scan.promise) });
      const reportError = vi.fn();
      const setMessage = vi.fn();
      const harness = renderLifecycle(gateway, reportError, setMessage);
      const authorityA = {};
      const replacementA = {};
      let currentAuthority = authorityA;

      let pending = Promise.resolve();
      act(() => {
        pending = harness
          .lifecycle()
          .startInitialIndexScan("/workspace", () => currentAuthority === authorityA);
      });
      currentAuthority = {};
      currentAuthority = replacementA;
      if (settlement === "resolve") {
        const operationGeneration = vi.mocked(gateway.startInitialMetadataScan).mock.calls[0]?.[0]
          .operationGeneration;
        if (operationGeneration === undefined) throw new Error("Missing operation generation");
        scan.resolve({
          databasePath: "/workspace/.index",
          operationGeneration,
          rootPath: "/workspace",
          status: "started",
        });
      }
      if (settlement === "reject") scan.reject(new Error("stale scan"));
      await act(async () => pending);

      expect(setMessage).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it("drops old progress and completion after an A to B to replacement A operation", async () => {
    let progressListener: ((event: IndexProgressEvent) => void) | null = null;
    let completionListener: ((event: MetadataScanCompletionEvent) => void) | null = null;
    const gateway = indexGateway({
      startInitialMetadataScan: vi.fn(async (request) => ({
        databasePath: `${request.rootPath}/.index`,
        operationGeneration: request.operationGeneration,
        rootPath: request.rootPath,
        status: "started" as const,
      })),
      subscribeIndexProgress: vi.fn(async (listener) => {
        progressListener = listener;
        return vi.fn();
      }),
      subscribeMetadataScanCompletion: vi.fn(async (listener) => {
        completionListener = listener;
        return vi.fn();
      }),
    });
    const reportError = vi.fn();
    const setMessage = vi.fn();
    const harness = renderLifecycle(gateway, reportError, setMessage);
    const authorityA = {};
    const replacementA = {};
    let currentAuthority = authorityA;

    await act(async () => {
      await harness
        .lifecycle()
        .startInitialIndexScan("/workspace", () => currentAuthority === authorityA);
    });
    const oldGeneration = vi.mocked(gateway.startInitialMetadataScan).mock.calls[0]?.[0]
      .operationGeneration;
    if (oldGeneration === undefined) throw new Error("Missing operation generation");
    currentAuthority = {};
    currentAuthority = replacementA;
    await act(async () => {
      await harness
        .lifecycle()
        .startInitialIndexScan("/workspace", () => currentAuthority === replacementA);
    });
    const replacementGeneration = vi.mocked(gateway.startInitialMetadataScan).mock.calls[1]?.[0]
      .operationGeneration;
    if (replacementGeneration === undefined) throw new Error("Missing replacement generation");
    setMessage.mockClear();

    act(() => {
      progressListener?.({
        operationGeneration: oldGeneration,
        phase: "scanning",
        processedFiles: 9,
        rootPath: "/workspace",
        totalFiles: 10,
      });
      completionListener?.({
        databasePath: "/workspace/.index",
        message: null,
        operationGeneration: oldGeneration,
        report: emptyScanReport(),
        rootPath: "/workspace",
        status: "completed",
      });
    });

    expect(setMessage).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    expect(harness.lifecycle().indexProgress).toEqual(
      expect.objectContaining({
        operationGeneration: replacementGeneration,
        processedFiles: 0,
        status: "scanning",
      }),
    );
    harness.unmount();
  });

  it("never reuses an exhausted operation generation", () => {
    const issuer = createIndexOperationGenerationIssuer(4_294_967_294);
    expect(issuer.issue()).toBe(4_294_967_295);
    expect(issuer.issue()).toBeNull();
    expect(issuer.issue()).toBeNull();
  });

  it("fails closed without a registered workspace admission", async () => {
    const gateway = indexGateway({});
    const harness = renderLifecycle(gateway, vi.fn(), vi.fn(), null);

    await act(async () => harness.lifecycle().startInitialIndexScan("/workspace", () => true));

    expect(gateway.startInitialMetadataScan).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("suppresses a manual reindex receipt after an exact owner replacement", async () => {
    const scan = deferred<InitialMetadataScanStart>();
    const gateway = indexGateway({ startReindex: vi.fn(() => scan.promise) });
    const reportError = vi.fn();
    const setMessage = vi.fn();
    const harness = renderLifecycle(gateway, reportError, setMessage);

    let pending = Promise.resolve();
    act(() => {
      pending = harness.lifecycle().startIndexScan();
    });
    const operationGeneration = vi.mocked(gateway.startReindex).mock.calls[0]?.[0]
      .operationGeneration;
    if (operationGeneration === undefined) throw new Error("Missing operation generation");
    harness.replaceOwner("workspace-b", 2);
    harness.replaceOwner("workspace-a", 3);
    scan.resolve({
      databasePath: "/workspace/.index",
      operationGeneration,
      rootPath: "/workspace",
      status: "started",
    });
    await act(async () => pending);

    expect(setMessage).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("suppresses a subscription rejection after an exact owner replacement", async () => {
    const subscription = deferred<() => void>();
    const gateway = indexGateway({
      subscribeIndexProgress: vi.fn(() => subscription.promise),
    });
    const reportError = vi.fn();
    const harness = renderLifecycle(gateway, reportError, vi.fn());

    harness.replaceOwner("workspace-b", 2);
    harness.replaceOwner("workspace-a", 3);
    subscription.reject(new Error("stale subscription"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("accepts an exact completion that arrives before the start receipt", async () => {
    const scan = deferred<InitialMetadataScanStart>();
    let completionListener: ((event: MetadataScanCompletionEvent) => void) | null = null;
    const gateway = indexGateway({
      startInitialMetadataScan: vi.fn(() => scan.promise),
      subscribeMetadataScanCompletion: vi.fn(async (listener) => {
        completionListener = listener;
        return vi.fn();
      }),
    });
    const harness = renderLifecycle(gateway, vi.fn(), vi.fn());

    let pending = Promise.resolve();
    act(() => {
      pending = harness.lifecycle().startInitialIndexScan("/workspace", () => true);
    });
    const operationGeneration = vi.mocked(gateway.startInitialMetadataScan).mock.calls[0]?.[0]
      .operationGeneration;
    if (operationGeneration === undefined) throw new Error("Missing operation generation");
    act(() => {
      completionListener?.({
        databasePath: "/workspace/.index",
        message: null,
        operationGeneration,
        report: emptyScanReport(),
        rootPath: "/workspace",
        status: "completed",
      });
    });
    scan.resolve({
      databasePath: "/workspace/.index",
      operationGeneration,
      rootPath: "/workspace",
      status: "started",
    });
    await act(async () => pending);

    expect(harness.lifecycle().indexProgress.status).toBe("completed");
    harness.unmount();
  });
});

function renderLifecycle(
  indexProgressGateway: IndexProgressGateway,
  reportError: (source: string, error: unknown) => void,
  setMessage: WorkbenchIndexLifecycleOptions["setMessage"],
  workspaceIdentityDescriptor: WorkbenchIndexLifecycleOptions["workspaceIdentityDescriptorRef"]["current"] = {
    admissionToken: 11,
    workspaceId: "workspace-a",
  },
) {
  const root = createRoot(document.createElement("div"));
  const workspaceRuntimeOwner = createWorkspaceRuntimeOwner("workspace-a", "/workspace");
  const workspaceRuntimeOwnerRef = { current: workspaceRuntimeOwner };
  let workspaceRuntimeGeneration = 1;
  let lifecycle: ReturnType<typeof useWorkbenchIndexLifecycle> | null = null;
  function Harness() {
    lifecycle = useWorkbenchIndexLifecycle({
      currentWorkspaceRootRef: { current: "/workspace" },
      indexProgressGateway,
      intelligenceMode: "fullSmart",
      intelligenceModeRef: { current: "fullSmart" },
      reportError,
      resetIndexedWorkspaceViews: vi.fn(),
      resetPhpFrameworkCaches: vi.fn(),
      setMessage,
      setNotices: vi.fn(),
      workspaceRoot: "/workspace",
      workspaceIdentityDescriptorRef: { current: workspaceIdentityDescriptor },
      workspaceRuntimeOwner,
      workspaceRuntimeOwnerGeneration: () => workspaceRuntimeGeneration,
      workspaceRuntimeOwnerRef,
    });
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    lifecycle: () => {
      if (!lifecycle) throw new Error("Index lifecycle was not rendered");
      return lifecycle;
    },
    replaceOwner: (ownerKey: string, generation: number) => {
      workspaceRuntimeOwnerRef.current = createWorkspaceRuntimeOwner(ownerKey, "/workspace");
      workspaceRuntimeGeneration = generation;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function emptyScanReport() {
  return {
    changedFiles: 0,
    errorDetails: [],
    erroredEntries: 0,
    indexedFiles: 0,
    parsedFiles: 0,
    removedFiles: 0,
    skippedDetails: [],
    skippedEntries: 0,
    symbolsIndexed: 0,
  };
}

function indexGateway(overrides: Partial<IndexProgressGateway>): IndexProgressGateway {
  return {
    clearWorkspaceIndex: vi.fn(async (request) => ({
      databasePath: "/workspace/.index",
      rootPath: request.rootPath,
      status: "cleared" as const,
    })),
    startInitialMetadataScan: vi.fn(async (request) => ({
      databasePath: "/workspace/.index",
      operationGeneration: request.operationGeneration,
      rootPath: request.rootPath,
      status: "started" as const,
    })),
    startReindex: vi.fn(async (request) => ({
      databasePath: "/workspace/.index",
      operationGeneration: request.operationGeneration,
      rootPath: request.rootPath,
      status: "started" as const,
    })),
    subscribeIndexProgress: vi.fn(async () => vi.fn()),
    subscribeMetadataScanCompletion: vi.fn(async () => vi.fn()),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}
