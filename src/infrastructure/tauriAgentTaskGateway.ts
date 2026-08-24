import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AgentTaskStartRejectedError,
  type AgentTaskGateway,
  type AgentTaskOutputEvent,
  type AgentTaskReferenceRequest,
  type AgentTaskStatusEvent,
  type StartAgentTaskRequest,
  type StartAgentTaskResult,
  type StopAgentTasksForRootRequest,
} from "../domain/agentTask";
import {
  AGENT_TASK_OUTPUT_EVENT,
  AGENT_TASK_STATUS_EVENT,
  decodeAgentTaskOutputEvent,
  decodeAgentTaskStatusEvent,
  invokeAcknowledgeAgentTaskStartIpc,
  invokeStartAgentTaskIpc,
  invokeStopAgentTaskIpc,
  invokeStopAgentTasksForRootIpc,
  type InvokeAgentTaskCommand,
} from "./tauriAgentTaskIpcContract";

export type ListenToAgentTaskEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

export type AgentTaskRuntimeDetector = () => boolean;

const invokeAgentTaskCommand: InvokeAgentTaskCommand = (command, args) => invoke(command, args);

const listenToAgentTaskEvents: ListenToAgentTaskEvent = (event, handler) =>
  listen<unknown>(event, handler);

const noopUnsubscribe = (): void => undefined;

export class TauriAgentTaskGateway implements AgentTaskGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentTaskCommand = invokeAgentTaskCommand,
    private readonly listenToEvent: ListenToAgentTaskEvent = listenToAgentTaskEvents,
    private readonly isRuntimeAvailable: AgentTaskRuntimeDetector = isTauri,
  ) {}

  async startAgentTask(request: StartAgentTaskRequest): Promise<StartAgentTaskResult> {
    if (!this.isRuntimeAvailable()) {
      throw new AgentTaskStartRejectedError("Agent tasks require the native runtime.");
    }
    return invokeStartAgentTaskIpc(this.invokeCommand, request);
  }

  async acknowledgeAgentTaskStart(request: AgentTaskReferenceRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) return;
    return invokeAcknowledgeAgentTaskStartIpc(this.invokeCommand, request);
  }

  async stopAgentTask(request: AgentTaskReferenceRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) return;
    return invokeStopAgentTaskIpc(this.invokeCommand, request);
  }

  async stopAgentTasksForRoot(request: StopAgentTasksForRootRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) return;
    return invokeStopAgentTasksForRootIpc(this.invokeCommand, request);
  }

  subscribeAgentTaskStatus(handler: (event: AgentTaskStatusEvent) => void): Promise<() => void> {
    return this.subscribe(AGENT_TASK_STATUS_EVENT, decodeAgentTaskStatusEvent, handler);
  }

  subscribeAgentTaskOutput(handler: (event: AgentTaskOutputEvent) => void): Promise<() => void> {
    return this.subscribe(AGENT_TASK_OUTPUT_EVENT, decodeAgentTaskOutputEvent, handler);
  }

  private subscribe<TEvent>(
    eventName: string,
    decode: (payload: unknown) => TEvent,
    handler: (event: TEvent) => void,
  ): Promise<() => void> {
    if (!this.isRuntimeAvailable()) return Promise.resolve(noopUnsubscribe);
    return this.listenToEvent(eventName, (event) => {
      const decoded = decodeOrNull(decode, event.payload);
      if (decoded === null) return;
      handler(decoded);
    });
  }
}

function decodeOrNull<TEvent>(
  decode: (payload: unknown) => TEvent,
  payload: unknown,
): TEvent | null {
  try {
    return decode(payload);
  } catch {
    return null;
  }
}
