import type { AgentExecutionTarget, AgentLaunchOptions } from "../../domain/agentLaunch";
import type {
  AgentNewThreadDefaults,
  AgentNewThreadLaunchSource,
} from "../../domain/agentNewThreadDefaults";
import { normalizeStoredAgentLaunch } from "../../domain/agentStoredLaunch";
import { isTerminalAgentTurnStatus, type AgentThread } from "../../domain/agentThread";
import { latestPromptedAgentLaunch } from "../../domain/agentTurnOrigin";
import type { AgentCliKind, AgentTaskIsolation } from "../../domain/agentTask";
import type { ClaudeModelManifest } from "../../domain/claudeModelCatalog";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  type CodexModelCatalog,
} from "../../domain/codexModelCatalog";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentClaudeModelChoiceForVersion } from "./agentLaunchPresentation";
import { lastAgentTurn } from "./agentModePresentation";
import { codexEffectiveModel } from "./codexLaunchPresentation";

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
  readonly rootKey: string | null;
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

export function newThreadComposerLaunch(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
): AgentLaunchOptions {
  const base = defaultAgentComposerLaunch(provider);
  if (base.provider === "claudeCode") {
    const { model, effort } = defaults.claudeCode;
    return normalizeStoredAgentLaunch({ ...base, model, effort });
  }
  const { model, effort } = defaults.codex;
  if (effort === "default") return normalizeStoredAgentLaunch({ ...base, model });
  return normalizeStoredAgentLaunch({ ...base, model, effort });
}

export function availableNewThreadDefaults(
  defaults: AgentNewThreadDefaults,
  claudeCatalog: ClaudeModelManifest,
  claudeCliVersion: string | null = null,
): AgentNewThreadDefaults {
  const { model, effort } = defaults.claudeCode;
  if (model === "default") return defaults;
  const offered =
    agentClaudeModelChoiceForVersion(model, claudeCliVersion, claudeCatalog) ?? "default";
  if (offered === model) return defaults;
  return { ...defaults, claudeCode: { model: offered, effort } };
}

export function launchScopeExecutionTarget(scope: LaunchScope): AgentExecutionTarget {
  if (scope.rootKey?.startsWith("remote:") === true) return "server";
  return "local";
}

export function providerSwitchComposerLaunch(
  configured: AgentLaunchOptions,
  picked: AgentLaunchOptions,
  configuredModel: string | null = null,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): AgentLaunchOptions {
  if (picked.provider !== configured.provider) return picked;
  if (picked.model === configured.model) return configured;
  if (
    configured.provider === "codex" &&
    picked.provider === "codex" &&
    codexEffectiveModel(configured.model, configuredModel, codexCatalog) ===
      codexEffectiveModel(picked.model, configuredModel, codexCatalog)
  ) {
    return configured;
  }
  return picked;
}

export function normalizeAgentComposerLaunch(launch: AgentLaunchOptions): AgentLaunchOptions {
  return normalizeStoredAgentLaunch(launch);
}

export function resolveLaunchScope(
  selectedThread: AgentThreadView | null,
  targetRootKey: string | null,
): LaunchScope {
  if (selectedThread !== null) {
    const thread = selectedThread.thread;
    return {
      key: `thread:${thread.threadId}`,
      rootKey: thread.owner.rootKey,
      seed: latestPromptedAgentLaunch(thread.turns),
    };
  }
  if (targetRootKey === null) return { key: "draft", rootKey: null, seed: null };
  return { key: `root:${targetRootKey}`, rootKey: targetRootKey, seed: null };
}

export function resolveComposerLaunch(
  choice: LaunchChoice | null,
  scope: LaunchScope | null,
  provider: AgentCliKind,
  lastUsedLaunch: (projectRootKey: string) => AgentLaunchOptions | null,
  defaults: AgentNewThreadDefaults,
): AgentLaunchOptions {
  if (scope === null) return newThreadComposerLaunch(provider, defaults);
  if (choice !== null && choice.key === scope.key && choice.launch.provider === provider) {
    return normalizeAgentComposerLaunch(choice.launch);
  }
  if (scope.seed !== null && scope.seed.provider === provider) {
    return normalizeAgentComposerLaunch(scope.seed);
  }
  const remembered = rememberedProjectLaunch(scope, provider, lastUsedLaunch, defaults.source);
  if (remembered !== null) return normalizeAgentComposerLaunch(remembered);
  return newThreadComposerLaunch(provider, defaults);
}

function rememberedProjectLaunch(
  scope: LaunchScope,
  provider: AgentCliKind,
  lastUsedLaunch: (projectRootKey: string) => AgentLaunchOptions | null,
  source: AgentNewThreadLaunchSource,
): AgentLaunchOptions | null {
  if (source !== "lastUsed") return null;
  if (scope.rootKey === null) return null;
  const remembered = lastUsedLaunch(scope.rootKey);
  if (remembered === null) return null;
  if (remembered.provider !== provider) return null;
  return remembered;
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
