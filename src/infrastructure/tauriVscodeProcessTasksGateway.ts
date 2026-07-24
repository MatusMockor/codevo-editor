import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { VscodeProcessTaskEvent, VscodeProcessTaskOwner } from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import {
  decodeVscodeProcessTaskEvent,
  invokeAcknowledgeVscodeProcessTaskStartIpc,
  invokeDiscoverVscodeProcessTasksIpc,
  invokeStartVscodeProcessTaskIpc,
  invokeStopVscodeProcessTaskIpc,
  VSCODE_PROCESS_TASK_EVENT,
  type InvokeVscodeProcessTaskCommand,
} from "./tauriVscodeProcessTasksIpcContract";

const invokeVscodeProcessTaskCommand: InvokeVscodeProcessTaskCommand = (command, args) =>
  invoke(command, args);

export type ListenToVscodeProcessTaskEvents = (
  event: string,
  handler: (event: { readonly payload: unknown }) => void,
) => Promise<() => void>;

const listenToVscodeProcessTaskEvents: ListenToVscodeProcessTaskEvents = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriVscodeProcessTasksGateway implements VscodeProcessTasksGateway {
  constructor(
    private readonly invokeCommand: InvokeVscodeProcessTaskCommand = invokeVscodeProcessTaskCommand,
    private readonly listenToEvent: ListenToVscodeProcessTaskEvents = listenToVscodeProcessTaskEvents,
  ) {}

  discoverVscodeProcessTasks(workspaceId: string) {
    return invokeDiscoverVscodeProcessTasksIpc(this.invokeCommand, { workspaceId });
  }

  startVscodeProcessTask(owner: VscodeProcessTaskOwner) {
    return invokeStartVscodeProcessTaskIpc(this.invokeCommand, owner);
  }

  acknowledgeVscodeProcessTaskStart(owner: VscodeProcessTaskOwner) {
    return invokeAcknowledgeVscodeProcessTaskStartIpc(this.invokeCommand, owner);
  }

  stopVscodeProcessTask(owner: VscodeProcessTaskOwner) {
    return invokeStopVscodeProcessTaskIpc(this.invokeCommand, owner);
  }

  subscribeVscodeProcessTaskEvents(
    handler: (event: VscodeProcessTaskEvent) => void,
  ): Promise<() => void> {
    return this.listenToEvent(VSCODE_PROCESS_TASK_EVENT, (event) => {
      try {
        handler(decodeVscodeProcessTaskEvent(event.payload));
      } catch {
        // Malformed backend events fail closed at the transport boundary.
      }
    });
  }
}
