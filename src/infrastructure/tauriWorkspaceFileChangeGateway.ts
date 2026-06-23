import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  WorkspaceFileChangeEvent,
  WorkspaceFileChangeGateway,
  WorkspaceFileChangeUnsubscribeFn,
} from "../domain/workspaceFileChange";

const WORKSPACE_FILE_CHANGED_EVENT = "workspace://file-changed";

type InvokeStartCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<void>;
type ListenToFileChangeEvent = (
  event: string,
  handler: (event: { payload: WorkspaceFileChangeEvent }) => void,
) => Promise<WorkspaceFileChangeUnsubscribeFn>;
type RuntimeDetector = () => boolean;

const invokeStartCommand: InvokeStartCommand = (command, args) =>
  invoke<void>(command, args);
const listenToFileChangeEvent: ListenToFileChangeEvent = (event, handler) =>
  listen<WorkspaceFileChangeEvent>(event, handler);

export class TauriWorkspaceFileChangeGateway
  implements WorkspaceFileChangeGateway
{
  constructor(
    private readonly invokeCommand: InvokeStartCommand = invokeStartCommand,
    private readonly listenToEvent: ListenToFileChangeEvent = listenToFileChangeEvent,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  startWatching(rootPath: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeCommand("start_workspace_file_watch", { rootPath });
  }

  subscribeFileChanges(
    listener: (event: WorkspaceFileChangeEvent) => void,
  ): Promise<WorkspaceFileChangeUnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(WORKSPACE_FILE_CHANGED_EVENT, (event) => {
      listener(event.payload);
    });
  }
}
