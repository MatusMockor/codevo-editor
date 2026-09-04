import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { isTerminalAgentTurnStatus, type AgentThread } from "../../domain/agentThread";
import type { AgentCliKind, AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { lastAgentTurn } from "./agentModePresentation";

export interface IsolationChoice {
  readonly repositoryRoot: string;
  readonly isolation: AgentTaskIsolation;
}

export interface LaunchChoice {
  readonly key: string;
  readonly launch: AgentLaunchOptions;
}

export interface LaunchScope {
  readonly key: string;
  readonly rootKey: string;
  readonly seed: AgentLaunchOptions | null;
}

export function defaultAgentComposerLaunch(provider: AgentCliKind): AgentLaunchOptions {
  if (provider === "claudeCode") {
    return {
      provider: "claudeCode",
      model: "default",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
      fastMode: false,
      thinkingMode: false,
    };
  }
  return { provider: "codex", model: "default", mode: "dangerFullAccess" };
}

/**
 * Stored threads created before full-access became the product default can
 * still contain the old CLI-inherited sentinel values. Those values are wire
 * compatibility only: the composer must always present and submit a concrete
 * T3-style launch policy.
 */
export function normalizeAgentComposerLaunch(launch: AgentLaunchOptions): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    return {
      ...launch,
      mode: launch.mode === "default" ? "bypassPermissions" : launch.mode,
      effort: launch.effort === "default" ? "high" : launch.effort,
      context: launch.context ?? "1m",
    };
  }
  return {
    ...launch,
    mode: launch.mode === "default" ? "dangerFullAccess" : launch.mode,
  };
}

export function resolveLaunchScope(
  selectedThread: AgentThreadView | null,
  targetRootKey: string | null,
): LaunchScope | null {
  if (selectedThread !== null) {
    const thread = selectedThread.thread;
    return {
      key: `thread:${thread.threadId}`,
      rootKey: thread.owner.rootKey,
      seed: lastAgentTurn(thread)?.launch ?? null,
    };
  }
  if (targetRootKey === null) return null;
  return { key: `root:${targetRootKey}`, rootKey: targetRootKey, seed: null };
}

export function resolveComposerLaunch(
  choice: LaunchChoice | null,
  scope: LaunchScope | null,
  provider: AgentCliKind,
  lastUsedLaunch: (projectRootKey: string) => AgentLaunchOptions | null,
): AgentLaunchOptions {
  if (scope === null) return defaultAgentComposerLaunch(provider);
  if (choice !== null && choice.key === scope.key && choice.launch.provider === provider) {
    return normalizeAgentComposerLaunch(choice.launch);
  }
  if (scope.seed !== null && scope.seed.provider === provider) {
    return normalizeAgentComposerLaunch(scope.seed);
  }
  const remembered = lastUsedLaunch(scope.rootKey);
  if (remembered !== null && remembered.provider === provider) {
    return normalizeAgentComposerLaunch(remembered);
  }
  return defaultAgentComposerLaunch(provider);
}

export function agentLaunchKey(launch: AgentLaunchOptions): string {
  return `${launch.provider}:${launch.model}:${launch.mode}`;
}

export function terminalTurnKey(thread: AgentThread | null): string | null {
  if (thread === null) return null;
  const turn = lastAgentTurn(thread);
  if (turn === null) return null;
  if (!isTerminalAgentTurnStatus(turn.status)) return null;
  return `${turn.turnId}:${turn.status.kind}:${turn.endedAtEpochMs ?? 0}`;
}
