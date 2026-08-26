import { describe, expect, it, vi } from "vitest";
import { TauriIndexProgressGateway } from "./tauriIndexProgressGateway";
import type {
  IndexProgressEvent,
  InitialMetadataScanStart,
  MetadataScanCompletionEvent,
  WorkspaceIndexClearResult,
} from "../domain/indexProgress";

type IndexGatewayConstructor = ConstructorParameters<typeof TauriIndexProgressGateway>;
type InvokeCommand = NonNullable<IndexGatewayConstructor[0]>;
type ListenToEvent = NonNullable<IndexGatewayConstructor[1]>;
type InvokeClearCommand = NonNullable<IndexGatewayConstructor[3]>;
type ListenToProgressEvent = NonNullable<IndexGatewayConstructor[4]>;

describe("TauriIndexProgressGateway", () => {
  it("keeps browser development runtime quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToEvent = vi.fn<ListenToEvent>();
    const invokeClearCommand = vi.fn<InvokeClearCommand>();
    const gateway = new TauriIndexProgressGateway(
      invokeCommand,
      listenToEvent,
      () => false,
      invokeClearCommand,
    );

    await expect(gateway.clearWorkspaceIndex(mutationRequest())).rejects.toThrow(
      "Indexing requires the Tauri desktop runtime.",
    );
    await expect(gateway.startInitialMetadataScan(operationRequest())).rejects.toThrow(
      "Indexing requires the Tauri desktop runtime.",
    );
    await expect(gateway.startReindex(operationRequest(), "soft")).rejects.toThrow(
      "Indexing requires the Tauri desktop runtime.",
    );

    const unsubscribe = await gateway.subscribeMetadataScanCompletion(vi.fn());
    unsubscribe();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(invokeClearCommand).not.toHaveBeenCalled();
    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("delegates start command and completion events inside Tauri", async () => {
    const start: InitialMetadataScanStart = {
      databasePath: "/config/index.sqlite3",
      operationGeneration: 7,
      rootPath: "/workspace",
      status: "started",
    };
    const clear: WorkspaceIndexClearResult = {
      databasePath: "/config/index.sqlite3",
      rootPath: "/workspace",
      status: "cleared",
    };
    const completion: MetadataScanCompletionEvent = {
      databasePath: "/config/index.sqlite3",
      message: null,
      operationGeneration: 7,
      report: {
        changedFiles: 3,
        errorDetails: [],
        erroredEntries: 0,
        indexedFiles: 12,
        parsedFiles: 3,
        removedFiles: 1,
        skippedDetails: [{ path: "vendor", reason: "Ignored by workspace rules." }],
        skippedEntries: 2,
        symbolsIndexed: 18,
      },
      rootPath: "/workspace",
      status: "completed",
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => start);
    const invokeClearCommand = vi.fn<InvokeClearCommand>(async () => clear);
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handler({ payload: completion });
      return () => undefined;
    });
    const listener = vi.fn();
    const gateway = new TauriIndexProgressGateway(
      invokeCommand,
      listenToEvent,
      () => true,
      invokeClearCommand,
    );

    await expect(gateway.clearWorkspaceIndex(mutationRequest())).resolves.toEqual(clear);
    await expect(gateway.startInitialMetadataScan(operationRequest())).resolves.toEqual(start);
    await expect(gateway.startReindex(operationRequest(), "language", "php")).resolves.toEqual(
      start,
    );
    await gateway.subscribeMetadataScanCompletion(listener);

    expect(invokeClearCommand).toHaveBeenCalledWith("clear_workspace_index", {
      request: mutationRequest(),
    });
    expect(invokeCommand).toHaveBeenCalledWith("start_initial_metadata_scan", {
      request: operationRequest(),
    });
    expect(invokeCommand).toHaveBeenCalledWith("start_workspace_reindex", {
      request: {
        admissionToken: 11,
        language: "php",
        mode: "language",
        operationGeneration: 7,
        rootPath: "/workspace",
        workspaceId: "workspace-1",
      },
    });
    expect(listenToEvent).toHaveBeenCalledWith(
      "index://metadata-scan-completed",
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(completion);
  });

  it("delegates incremental progress events inside Tauri", async () => {
    const progress: IndexProgressEvent = {
      operationGeneration: 7,
      phase: "parsing",
      processedFiles: 500,
      rootPath: "/workspace",
      totalFiles: 1200,
    };
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToProgressEvent = vi.fn<ListenToProgressEvent>(async (_event, handler) => {
      handler({ payload: progress });
      return () => undefined;
    });
    const listener = vi.fn();
    const gateway = new TauriIndexProgressGateway(
      invokeCommand,
      vi.fn<ListenToEvent>(),
      () => true,
      vi.fn<InvokeClearCommand>(),
      listenToProgressEvent,
    );

    await gateway.subscribeIndexProgress(listener);

    expect(listenToProgressEvent).toHaveBeenCalledWith("index://progress", expect.any(Function));
    expect(listener).toHaveBeenCalledWith(progress);
  });

  it("keeps progress subscription quiet outside Tauri", async () => {
    const listenToProgressEvent = vi.fn<ListenToProgressEvent>();
    const gateway = new TauriIndexProgressGateway(
      vi.fn<InvokeCommand>(),
      vi.fn<ListenToEvent>(),
      () => false,
      vi.fn<InvokeClearCommand>(),
      listenToProgressEvent,
    );

    const unsubscribe = await gateway.subscribeIndexProgress(vi.fn());
    unsubscribe();

    expect(listenToProgressEvent).not.toHaveBeenCalled();
  });

  it.each([0, 4_294_967_296, 1.5])(
    "rejects outbound operation generation %s",
    async (operationGeneration) => {
      const invokeCommand = vi.fn<InvokeCommand>();
      const gateway = new TauriIndexProgressGateway(
        invokeCommand,
        vi.fn<ListenToEvent>(),
        () => true,
      );

      await expect(
        gateway.startInitialMetadataScan(operationRequest({ operationGeneration })),
      ).rejects.toThrow("Invalid index progress payload.");
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["language", undefined],
    ["language", "rust"],
    ["soft", "php"],
    ["hard", "typescript"],
  ] as const)("rejects invalid reindex combination %s/%s", async (mode, language) => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriIndexProgressGateway(
      invokeCommand,
      vi.fn<ListenToEvent>(),
      () => true,
    );

    await expect(gateway.startReindex(operationRequest(), mode, language)).rejects.toThrow(
      "Invalid index progress payload.",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    { ...operationRequest(), admissionToken: 0 },
    { ...operationRequest(), workspaceId: "" },
    { ...operationRequest(), unknown: true },
  ])("rejects invalid outbound workspace authority %#", async (request) => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriIndexProgressGateway(
      invokeCommand,
      vi.fn<ListenToEvent>(),
      () => true,
    );

    await expect(gateway.startInitialMetadataScan(request)).rejects.toThrow(
      "Invalid index progress payload.",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects unknown and missing start response fields", async () => {
    const invalidResponses = [
      {
        databasePath: "/config/index.sqlite3",
        operationGeneration: 7,
        rootPath: "/workspace",
        status: "started",
        unknown: true,
      },
      {
        databasePath: "/config/index.sqlite3",
        rootPath: "/workspace",
        status: "started",
      },
    ];

    for (const response of invalidResponses) {
      const gateway = new TauriIndexProgressGateway(
        vi.fn<InvokeCommand>(async () => response),
        vi.fn<ListenToEvent>(),
        () => true,
      );
      await expect(gateway.startInitialMetadataScan(operationRequest())).rejects.toThrow(
        "Invalid index progress payload.",
      );
    }
  });

  it("rejects a start response for another operation generation", async () => {
    const gateway = new TauriIndexProgressGateway(
      vi.fn<InvokeCommand>(async () => ({
        databasePath: "/config/index.sqlite3",
        operationGeneration: 8,
        rootPath: "/workspace",
        status: "started",
      })),
      vi.fn<ListenToEvent>(),
      () => true,
    );

    await expect(gateway.startInitialMetadataScan(operationRequest())).rejects.toThrow(
      "Invalid index progress payload.",
    );
  });

  it("drops invalid progress and completion event generations", async () => {
    const progressListener = vi.fn();
    const completionListener = vi.fn();
    const listenToProgressEvent = vi.fn<ListenToProgressEvent>(async (_event, handler) => {
      handler({
        payload: {
          operationGeneration: 0,
          phase: "parsing",
          processedFiles: 1,
          rootPath: "/workspace",
          totalFiles: 2,
        },
      });
      return () => undefined;
    });
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handler({
        payload: {
          databasePath: "/config/index.sqlite3",
          message: null,
          operationGeneration: 4_294_967_296,
          report: null,
          rootPath: "/workspace",
          status: "completed",
        },
      });
      return () => undefined;
    });
    const gateway = new TauriIndexProgressGateway(
      vi.fn<InvokeCommand>(),
      listenToEvent,
      () => true,
      vi.fn<InvokeClearCommand>(),
      listenToProgressEvent,
    );

    await gateway.subscribeIndexProgress(progressListener);
    await gateway.subscribeMetadataScanCompletion(completionListener);

    expect(progressListener).not.toHaveBeenCalled();
    expect(completionListener).not.toHaveBeenCalled();
  });

  it("drops event payloads with unknown fields", async () => {
    const listener = vi.fn();
    const listenToProgressEvent = vi.fn<ListenToProgressEvent>(async (_event, handler) => {
      handler({
        payload: {
          operationGeneration: 7,
          phase: "parsing",
          processedFiles: 1,
          rootPath: "/workspace",
          totalFiles: 2,
          unknown: true,
        },
      });
      return () => undefined;
    });
    const gateway = new TauriIndexProgressGateway(
      vi.fn<InvokeCommand>(),
      vi.fn<ListenToEvent>(),
      () => true,
      vi.fn<InvokeClearCommand>(),
      listenToProgressEvent,
    );

    await gateway.subscribeIndexProgress(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it.each(["unknown", "", 1])("drops invalid progress phase %#", async (phase) => {
    const listener = vi.fn();
    const listenToProgressEvent = vi.fn<ListenToProgressEvent>(async (_event, handler) => {
      handler({
        payload: {
          operationGeneration: 7,
          phase,
          processedFiles: 1,
          rootPath: "/workspace",
          totalFiles: 2,
        },
      });
      return () => undefined;
    });
    const gateway = new TauriIndexProgressGateway(
      vi.fn<InvokeCommand>(),
      vi.fn<ListenToEvent>(),
      () => true,
      vi.fn<InvokeClearCommand>(),
      listenToProgressEvent,
    );

    await gateway.subscribeIndexProgress(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    { message: null, report: null, status: "completed" },
    { message: "failed", report: report(), status: "failed" },
  ])("drops impossible completion variant %#", async (variant) => {
    const listener = vi.fn();
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handler({
        payload: {
          databasePath: "/config/index.sqlite3",
          operationGeneration: 7,
          rootPath: "/workspace",
          ...variant,
        },
      });
      return () => undefined;
    });
    const gateway = new TauriIndexProgressGateway(
      vi.fn<InvokeCommand>(),
      listenToEvent,
      () => true,
    );

    await gateway.subscribeMetadataScanCompletion(listener);

    expect(listener).not.toHaveBeenCalled();
  });
});

function mutationRequest() {
  return {
    admissionToken: 11,
    rootPath: "/workspace",
    workspaceId: "workspace-1",
  };
}

function operationRequest(
  overrides: Partial<ReturnType<typeof mutationRequest>> & {
    operationGeneration?: number;
  } = {},
) {
  return {
    ...mutationRequest(),
    operationGeneration: 7,
    ...overrides,
  };
}

function report() {
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
