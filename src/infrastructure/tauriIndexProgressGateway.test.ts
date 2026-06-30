import { describe, expect, it, vi } from "vitest";
import { TauriIndexProgressGateway } from "./tauriIndexProgressGateway";
import type {
  IndexProgressEvent,
  InitialMetadataScanStart,
  MetadataScanCompletionEvent,
  WorkspaceIndexClearResult,
} from "../domain/indexProgress";

type IndexGatewayConstructor = ConstructorParameters<
  typeof TauriIndexProgressGateway
>;
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

    await expect(gateway.clearWorkspaceIndex("/workspace")).rejects.toThrow(
      "Indexing requires the Tauri desktop runtime.",
    );
    await expect(
      gateway.startInitialMetadataScan("/workspace"),
    ).rejects.toThrow("Indexing requires the Tauri desktop runtime.");
    await expect(gateway.startReindex("/workspace", "soft")).rejects.toThrow(
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

    await expect(gateway.clearWorkspaceIndex("/workspace")).resolves.toEqual(
      clear,
    );
    await expect(gateway.startInitialMetadataScan("/workspace")).resolves.toEqual(
      start,
    );
    await expect(gateway.startReindex("/workspace", "language", "php")).resolves.toEqual(
      start,
    );
    await gateway.subscribeMetadataScanCompletion(listener);

    expect(invokeClearCommand).toHaveBeenCalledWith("clear_workspace_index", {
      rootPath: "/workspace",
    });
    expect(invokeCommand).toHaveBeenCalledWith("start_initial_metadata_scan", {
      rootPath: "/workspace",
    });
    expect(invokeCommand).toHaveBeenCalledWith("start_workspace_reindex", {
      language: "php",
      mode: "language",
      rootPath: "/workspace",
    });
    expect(listenToEvent).toHaveBeenCalledWith(
      "index://metadata-scan-completed",
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(completion);
  });

  it("delegates incremental progress events inside Tauri", async () => {
    const progress: IndexProgressEvent = {
      phase: "parsing",
      processedFiles: 500,
      rootPath: "/workspace",
      totalFiles: 1200,
    };
    const invokeCommand = vi.fn<InvokeCommand>();
    const listenToProgressEvent = vi.fn<ListenToProgressEvent>(
      async (_event, handler) => {
        handler({ payload: progress });
        return () => undefined;
      },
    );
    const listener = vi.fn();
    const gateway = new TauriIndexProgressGateway(
      invokeCommand,
      vi.fn<ListenToEvent>(),
      () => true,
      vi.fn<InvokeClearCommand>(),
      listenToProgressEvent,
    );

    await gateway.subscribeIndexProgress(listener);

    expect(listenToProgressEvent).toHaveBeenCalledWith(
      "index://progress",
      expect.any(Function),
    );
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
});
