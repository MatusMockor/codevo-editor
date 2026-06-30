import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  IndexProgressEvent,
  IndexProgressGateway,
  InitialMetadataScanStart,
  MetadataScanCompletionEvent,
  UnsubscribeFn,
  WorkspaceIndexClearResult,
  WorkspaceReindexMode,
} from "../domain/indexProgress";

const METADATA_SCAN_COMPLETED_EVENT = "index://metadata-scan-completed";
const INDEX_PROGRESS_EVENT = "index://progress";
const DESKTOP_RUNTIME_REQUIRED = "Indexing requires the Tauri desktop runtime.";

type InvokeIndexCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<InitialMetadataScanStart>;
type InvokeClearIndexCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<WorkspaceIndexClearResult>;
type ListenToIndexEvent = (
  event: string,
  handler: (event: { payload: MetadataScanCompletionEvent }) => void,
) => Promise<UnsubscribeFn>;
type ListenToProgressEvent = (
  event: string,
  handler: (event: { payload: IndexProgressEvent }) => void,
) => Promise<UnsubscribeFn>;
type RuntimeDetector = () => boolean;

const invokeIndexCommand: InvokeIndexCommand = (command, args) =>
  invoke<InitialMetadataScanStart>(command, args);
const invokeClearIndexCommand: InvokeClearIndexCommand = (command, args) =>
  invoke<WorkspaceIndexClearResult>(command, args);
const listenToIndexEvent: ListenToIndexEvent = (event, handler) =>
  listen<MetadataScanCompletionEvent>(event, handler);
const listenToProgressEvent: ListenToProgressEvent = (event, handler) =>
  listen<IndexProgressEvent>(event, handler);

export class TauriIndexProgressGateway implements IndexProgressGateway {
  constructor(
    private readonly invokeCommand: InvokeIndexCommand = invokeIndexCommand,
    private readonly listenToEvent: ListenToIndexEvent = listenToIndexEvent,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly invokeClearCommand: InvokeClearIndexCommand = invokeClearIndexCommand,
    private readonly listenToProgress: ListenToProgressEvent = listenToProgressEvent,
  ) {}

  clearWorkspaceIndex(rootPath: string): Promise<WorkspaceIndexClearResult> {
    if (!this.isRuntimeAvailable()) {
      return Promise.reject(new Error(DESKTOP_RUNTIME_REQUIRED));
    }

    return this.invokeClearCommand("clear_workspace_index", {
      rootPath,
    });
  }

  startInitialMetadataScan(rootPath: string): Promise<InitialMetadataScanStart> {
    if (!this.isRuntimeAvailable()) {
      return Promise.reject(new Error(DESKTOP_RUNTIME_REQUIRED));
    }

    return this.invokeCommand("start_initial_metadata_scan", {
      rootPath,
    });
  }

  startReindex(
    rootPath: string,
    mode: WorkspaceReindexMode,
    language?: string,
  ): Promise<InitialMetadataScanStart> {
    if (!this.isRuntimeAvailable()) {
      return Promise.reject(new Error(DESKTOP_RUNTIME_REQUIRED));
    }

    return this.invokeCommand("start_workspace_reindex", {
      language,
      mode,
      rootPath,
    });
  }

  subscribeIndexProgress(
    listener: (event: IndexProgressEvent) => void,
  ): Promise<UnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToProgress(INDEX_PROGRESS_EVENT, (event) => {
      listener(event.payload);
    });
  }

  subscribeMetadataScanCompletion(
    listener: (event: MetadataScanCompletionEvent) => void,
  ): Promise<UnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(METADATA_SCAN_COMPLETED_EVENT, (event) => {
      listener(event.payload);
    });
  }
}
