import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL,
  type AgentThreadRequestFeed,
  type AgentThreadRequestScope,
} from "../application/agentThreadRequestPorts";
import { parseAgentThreadRequests, type AgentThreadRequests } from "../domain/agentRuntimeRequest";
import { MAX_AGENT_TASK_PATH_BYTES, MAX_AGENT_TASK_WORKSPACE_ID_BYTES } from "../domain/agentTask";

export const AGENT_THREAD_REQUESTS_EVENT = "agent-thread://requests" as const;
export const GET_AGENT_THREAD_REQUESTS_IPC_COMMAND = "get_agent_thread_requests" as const;

export interface AgentThreadRequestsIpcRequest {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
  readonly turnIds: readonly string[];
}

export type InvokeAgentThreadRequestCommand = (
  command: string,
  args: { readonly request: AgentThreadRequestsIpcRequest },
) => Promise<unknown>;

export type ListenToAgentThreadRequestEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

export type AgentThreadRequestRuntimeDetector = () => boolean;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CONTROL_PATTERN = /\p{Cc}/u;
const encoder = new TextEncoder();

const invokeAgentThreadRequestCommand: InvokeAgentThreadRequestCommand = (command, args) =>
  invoke(command, args);

const listenToAgentThreadRequestEvents: ListenToAgentThreadRequestEvent = (event, handler) =>
  listen<unknown>(event, handler);

function invalid(): never {
  throw new Error("Invalid agent thread request scope.");
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) return invalid();
  return value;
}

function boundedText(value: unknown, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0) return invalid();
  if (value.length > maxBytes || CONTROL_PATTERN.test(value)) return invalid();
  if (encoder.encode(value).length > maxBytes) return invalid();
  return value;
}

function turnIdentifiers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return invalid();
  if (value.length > MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL) return invalid();
  const turnIds = (value as readonly unknown[]).map(identifier);
  if (new Set(turnIds).size !== turnIds.length) return invalid();
  return turnIds;
}

function ipcRequest(
  scope: AgentThreadRequestScope,
  turnIds: readonly string[],
): AgentThreadRequestsIpcRequest {
  if (scope === null || typeof scope !== "object") return invalid();
  return {
    rootKey: boundedText(scope.rootKey, MAX_AGENT_TASK_PATH_BYTES),
    ownerId: boundedText(scope.ownerId, MAX_AGENT_TASK_WORKSPACE_ID_BYTES),
    threadId: identifier(scope.threadId),
    turnIds: turnIdentifiers(turnIds),
  };
}

function decodeOrNull(payload: unknown): AgentThreadRequests | null {
  try {
    return parseAgentThreadRequests(payload);
  } catch {
    return null;
  }
}

function runtimeUnavailable(): Error {
  return new Error("Agent thread requests need the native runtime.");
}

export class TauriAgentThreadRequestFeed implements AgentThreadRequestFeed {
  constructor(
    private readonly invokeCommand: InvokeAgentThreadRequestCommand = invokeAgentThreadRequestCommand,
    private readonly listenToEvent: ListenToAgentThreadRequestEvent = listenToAgentThreadRequestEvents,
    private readonly isRuntimeAvailable: AgentThreadRequestRuntimeDetector = isTauri,
  ) {}

  async currentThreadRequests(
    scope: AgentThreadRequestScope,
    turnIds: readonly string[],
  ): Promise<AgentThreadRequests> {
    const request = ipcRequest(scope, turnIds);
    if (!this.isRuntimeAvailable()) throw runtimeUnavailable();
    const message = parseAgentThreadRequests(
      await this.invokeCommand(GET_AGENT_THREAD_REQUESTS_IPC_COMMAND, { request }),
    );
    if (message.threadId !== request.threadId)
      throw new Error("Agent thread requests belong to another thread.");
    return message;
  }

  subscribeThreadRequests(handler: (message: AgentThreadRequests) => void): Promise<() => void> {
    if (!this.isRuntimeAvailable()) return Promise.reject(runtimeUnavailable());
    return this.listenToEvent(AGENT_THREAD_REQUESTS_EVENT, (event) => {
      const message = decodeOrNull(event.payload);
      if (message === null) return;
      handler(message);
    });
  }
}
