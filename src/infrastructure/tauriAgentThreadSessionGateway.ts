import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AGENT_SESSION_BACKGROUND_TASKS_EVENT,
  AGENT_SESSION_BACKGROUND_TURN_EVENT,
  AGENT_SESSION_ENDED_EVENT,
  parseAgentBackgroundTaskStopOutcome,
  parseAgentSessionBackgroundLevels,
  parseAgentSessionBackgroundTasksEvent,
  parseAgentSessionBackgroundTurnEvent,
  parseAgentSessionEndedEvent,
  parseAgentSessionInspection,
  parseAgentTaskInterruptOutcome,
  parseEndAgentThreadSessionResult,
  validateAgentThreadSessionRequest,
  validateInspectAgentThreadSessionRequest,
  validateInterruptAgentTaskRequest,
  validateStopAgentBackgroundTaskRequest,
  type AgentBackgroundTaskStopOutcome,
  type AgentSessionBackgroundTasksEvent,
  type AgentSessionBackgroundTurnEvent,
  type AgentSessionEndedEvent,
  type AgentSessionInspection,
  type AgentTaskInterruptOutcome,
  type AgentThreadSessionGateway,
  type AgentThreadSessionRequest,
  type InspectAgentThreadSessionRequest,
  type InterruptAgentTaskRequest,
  type StopAgentBackgroundTaskRequest,
} from "../domain/agentThreadSession";
import type { AgentTaskRuntimeDetector, ListenToAgentTaskEvent } from "./tauriAgentTaskGateway";
import type { InvokeAgentTaskCommand } from "./tauriAgentTaskIpcContract";

export const INTERRUPT_AGENT_TASK_IPC_COMMAND = "interrupt_agent_task" as const;
export const INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND = "inspect_agent_thread_session" as const;
export const END_AGENT_THREAD_SESSION_IPC_COMMAND = "end_agent_thread_session" as const;
export const STOP_AGENT_BACKGROUND_TASK_IPC_COMMAND = "stop_agent_background_task" as const;
export const LIST_AGENT_SESSION_BACKGROUNDS_IPC_COMMAND = "list_agent_session_backgrounds" as const;

const invokeSessionCommand: InvokeAgentTaskCommand = (command, args) => invoke(command, args);

const listenToSessionEvents: ListenToAgentTaskEvent = (event, handler) =>
  listen<unknown>(event, handler);

const noopUnsubscribe = (): void => undefined;

export class TauriAgentThreadSessionGateway implements AgentThreadSessionGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentTaskCommand = invokeSessionCommand,
    private readonly listenToEvent: ListenToAgentTaskEvent = listenToSessionEvents,
    private readonly isRuntimeAvailable: AgentTaskRuntimeDetector = isTauri,
  ) {}

  async interruptAgentTask(request: InterruptAgentTaskRequest): Promise<AgentTaskInterruptOutcome> {
    if (!this.isRuntimeAvailable()) return { kind: "unsupported" };
    const validated = validateInterruptAgentTaskRequest(request);
    return parseAgentTaskInterruptOutcome(
      await this.invokeCommand(INTERRUPT_AGENT_TASK_IPC_COMMAND, { request: validated }),
    );
  }

  async inspectAgentThreadSession(
    request: InspectAgentThreadSessionRequest,
  ): Promise<AgentSessionInspection> {
    if (!this.isRuntimeAvailable()) return { kind: "none" };
    const validated = validateInspectAgentThreadSessionRequest(request);
    return parseAgentSessionInspection(
      await this.invokeCommand(INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND, { request: validated }),
    );
  }

  async endAgentThreadSession(request: AgentThreadSessionRequest): Promise<boolean> {
    if (!this.isRuntimeAvailable()) return false;
    const validated = validateAgentThreadSessionRequest(request);
    return parseEndAgentThreadSessionResult(
      await this.invokeCommand(END_AGENT_THREAD_SESSION_IPC_COMMAND, { request: validated }),
    );
  }

  async stopAgentBackgroundTask(
    request: StopAgentBackgroundTaskRequest,
  ): Promise<AgentBackgroundTaskStopOutcome> {
    if (!this.isRuntimeAvailable()) return { kind: "unavailable" };
    const validated = validateStopAgentBackgroundTaskRequest(request);
    return parseAgentBackgroundTaskStopOutcome(
      await this.invokeCommand(STOP_AGENT_BACKGROUND_TASK_IPC_COMMAND, { request: validated }),
    );
  }

  async listAgentSessionBackgrounds(): Promise<ReadonlyArray<AgentSessionBackgroundTasksEvent>> {
    if (!this.isRuntimeAvailable()) return [];
    return parseAgentSessionBackgroundLevels(
      await this.invokeCommand(LIST_AGENT_SESSION_BACKGROUNDS_IPC_COMMAND, { request: {} }),
    );
  }

  subscribeAgentSessionEnded(
    handler: (event: AgentSessionEndedEvent) => void,
  ): Promise<() => void> {
    return this.subscribe(AGENT_SESSION_ENDED_EVENT, parseAgentSessionEndedEvent, handler);
  }

  subscribeAgentSessionBackgroundTurn(
    handler: (event: AgentSessionBackgroundTurnEvent) => void,
  ): Promise<() => void> {
    return this.subscribe(
      AGENT_SESSION_BACKGROUND_TURN_EVENT,
      parseAgentSessionBackgroundTurnEvent,
      handler,
    );
  }

  subscribeAgentSessionBackgroundTasks(
    handler: (event: AgentSessionBackgroundTasksEvent) => void,
  ): Promise<() => void> {
    return this.subscribe(
      AGENT_SESSION_BACKGROUND_TASKS_EVENT,
      parseAgentSessionBackgroundTasksEvent,
      handler,
    );
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
