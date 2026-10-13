import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentInteractionFeed,
  AgentInteractionOwner,
} from "../application/agentInteractionPorts";
import {
  parseAgentInteractionSnapshot,
  type AgentInteractionSnapshot,
} from "../domain/agentInteractionSnapshot";
import {
  agentInteractionAuthority,
  type AgentLocalInteractionAuthority,
} from "./agentQuestionAuthority";

export const AGENT_INTERACTIONS_EVENT = "agent-task://interactions" as const;
export const GET_AGENT_INTERACTIONS_IPC_COMMAND = "get_agent_interactions" as const;

export type InvokeAgentInteractionCommand = (
  command: string,
  args: { readonly request: unknown },
) => Promise<unknown>;

export type ListenToAgentInteractionEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

export type AgentInteractionRuntimeDetector = () => boolean;

const invokeAgentInteractionCommand: InvokeAgentInteractionCommand = (command, args) =>
  invoke(command, args);

const listenToAgentInteractionEvents: ListenToAgentInteractionEvent = (event, handler) =>
  listen<unknown>(event, handler);

const noopUnsubscribe = (): void => undefined;

function decodeOrNull(payload: unknown): AgentInteractionSnapshot | null {
  try {
    return parseAgentInteractionSnapshot(payload);
  } catch {
    return null;
  }
}

function emptySnapshot(authority: AgentLocalInteractionAuthority): AgentInteractionSnapshot {
  return {
    workspaceId: authority.workspaceId,
    taskId: authority.taskId,
    sequence: 0,
    questions: [],
    approvals: [],
  };
}

export class TauriAgentInteractionFeed implements AgentInteractionFeed {
  constructor(
    private readonly invokeCommand: InvokeAgentInteractionCommand = invokeAgentInteractionCommand,
    private readonly listenToEvent: ListenToAgentInteractionEvent = listenToAgentInteractionEvents,
    private readonly isRuntimeAvailable: AgentInteractionRuntimeDetector = isTauri,
  ) {}

  async currentInteractions(owner: AgentInteractionOwner): Promise<AgentInteractionSnapshot> {
    const authority = agentInteractionAuthority(owner);
    if (!this.isRuntimeAvailable()) return emptySnapshot(authority);
    const snapshot = parseAgentInteractionSnapshot(
      await this.invokeCommand(GET_AGENT_INTERACTIONS_IPC_COMMAND, { request: authority }),
    );
    if (snapshot.workspaceId !== authority.workspaceId || snapshot.taskId !== authority.taskId)
      throw new Error("Agent interactions belong to another task.");
    return snapshot;
  }

  subscribeInteractions(
    handler: (snapshot: AgentInteractionSnapshot) => void,
  ): Promise<() => void> {
    if (!this.isRuntimeAvailable()) return Promise.resolve(noopUnsubscribe);
    return this.listenToEvent(AGENT_INTERACTIONS_EVENT, (event) => {
      const snapshot = decodeOrNull(event.payload);
      if (snapshot === null) return;
      handler(snapshot);
    });
  }
}
