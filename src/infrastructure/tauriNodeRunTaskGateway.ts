import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  NodeRunTaskGateway,
  NodeRunTaskStatusEvent,
  StartNodeRunTaskRequest,
  StartNodeRunTaskResult,
  StopNodeRunTaskRequest,
} from "../domain/nodeRunTask";
import {
  decodeNodeRunTaskStatusEvent,
  invokeAcknowledgeNodeRunTaskStartIpc,
  invokeStartNodeRunTaskIpc,
  invokeStopNodeRunTaskIpc,
  NODE_RUN_TASK_STATUS_EVENT,
  type InvokeNodeRunTaskCommand,
} from "./tauriNodeRunTaskIpcContract";

const invokeNodeRunTaskCommand: InvokeNodeRunTaskCommand = (command, args) => invoke(command, args);

export type ListenToNodeRunTaskStatus = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

const listenToNodeRunTaskStatus: ListenToNodeRunTaskStatus = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriNodeRunTaskGateway implements NodeRunTaskGateway {
  constructor(
    private readonly invokeCommand: InvokeNodeRunTaskCommand = invokeNodeRunTaskCommand,
    private readonly listenToStatus: ListenToNodeRunTaskStatus = listenToNodeRunTaskStatus,
  ) {}

  startNodeRunTask(request: StartNodeRunTaskRequest): Promise<StartNodeRunTaskResult> {
    return invokeStartNodeRunTaskIpc(this.invokeCommand, request);
  }

  acknowledgeNodeRunTaskStart(request: StopNodeRunTaskRequest): Promise<void> {
    return invokeAcknowledgeNodeRunTaskStartIpc(this.invokeCommand, request);
  }

  stopNodeRunTask(request: StopNodeRunTaskRequest): Promise<void> {
    return invokeStopNodeRunTaskIpc(this.invokeCommand, request);
  }

  subscribeNodeRunTaskStatus(
    handler: (event: NodeRunTaskStatusEvent) => void,
  ): Promise<() => void> {
    return this.listenToStatus(NODE_RUN_TASK_STATUS_EVENT, (event) => {
      try {
        handler(decodeNodeRunTaskStatusEvent(event.payload));
      } catch {
        // Malformed native events fail closed at the adapter boundary.
      }
    });
  }
}
