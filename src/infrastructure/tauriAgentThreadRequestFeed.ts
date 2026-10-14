import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL,
  type AgentThreadRequestFeed,
  type AgentThreadRequestScope,
  type AgentThreadRequestsPage,
} from "../application/agentThreadRequestPorts";
import { parseAgentThreadRequests, type AgentThreadRequests } from "../domain/agentRuntimeRequest";
import { MAX_AGENT_TASK_PATH_BYTES, MAX_AGENT_TASK_WORKSPACE_ID_BYTES } from "../domain/agentTask";

export const AGENT_THREAD_REQUESTS_EVENT = "agent-thread://requests" as const;
export const GET_AGENT_THREAD_REQUESTS_IPC_COMMAND = "get_agent_thread_requests" as const;
export const MAX_AGENT_THREAD_REQUESTS_CURSOR_CHARS = 256;

export interface AgentThreadRequestsIpcRequest {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
  readonly turnIds: readonly string[];
  readonly cursor: string | null;
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
const CURSOR_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const CONTROL_PATTERN = /\p{Cc}/u;
const PAGE_FIELDS = ["message", "nextCursor"] as const;
const encoder = new TextEncoder();

const invokeAgentThreadRequestCommand: InvokeAgentThreadRequestCommand = (command, args) =>
  invoke(command, args);

const listenToAgentThreadRequestEvents: ListenToAgentThreadRequestEvent = (event, handler) =>
  listen<unknown>(event, handler);

function invalid(): never {
  throw new Error("Invalid agent thread request pull.");
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

function pageCursor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > MAX_AGENT_THREAD_REQUESTS_CURSOR_CHARS)
    return invalid();
  if (!CURSOR_PATTERN.test(value)) return invalid();
  return value;
}

function parsePage(value: unknown): AgentThreadRequestsPage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  if (Object.keys(value).length !== PAGE_FIELDS.length) return invalid();
  const page = value as Partial<Record<(typeof PAGE_FIELDS)[number], unknown>>;
  return {
    message: parseAgentThreadRequests(page.message),
    nextCursor: pageCursor(page.nextCursor),
  };
}

function ipcRequest(
  scope: AgentThreadRequestScope,
  turnIds: readonly string[],
  cursor: string | null,
): AgentThreadRequestsIpcRequest {
  if (scope === null || typeof scope !== "object") return invalid();
  return {
    rootKey: boundedText(scope.rootKey, MAX_AGENT_TASK_PATH_BYTES),
    ownerId: boundedText(scope.ownerId, MAX_AGENT_TASK_WORKSPACE_ID_BYTES),
    threadId: identifier(scope.threadId),
    turnIds: turnIdentifiers(turnIds),
    cursor: pageCursor(cursor),
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
    cursor: string | null,
  ): Promise<AgentThreadRequestsPage> {
    const request = ipcRequest(scope, turnIds, cursor);
    if (!this.isRuntimeAvailable()) throw runtimeUnavailable();
    const page = parsePage(
      await this.invokeCommand(GET_AGENT_THREAD_REQUESTS_IPC_COMMAND, { request }),
    );
    if (page.message.threadId !== request.threadId)
      throw new Error("Agent thread requests belong to another thread.");
    if (page.message.reset || page.message.workspaceId !== null)
      throw new Error("Agent thread requests were answered with a pushed message.");
    return page;
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
