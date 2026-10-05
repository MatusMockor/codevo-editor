import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
} from "../../application/useAgentProviderManagement";
import {
  defaultAgentCliDiscoveryResult,
  type AgentCliDiscoveryResult,
  type AgentCliKind,
} from "../../domain/agentSettings";
import type { ClaudeManifestModel, ClaudeModelManifest } from "../../domain/claudeModelCatalog";
import type { CodexCatalogModel, CodexModelCatalog } from "../../domain/codexModelCatalog";
import type { AgentNewThreadModelContext } from "./agentNewThreadDefaultsPresentation";

const CLAUDE_MODEL_BASE = {
  contextWindows: ["200k", "1m"],
  defaultContext: "1m",
  fastMode: false,
  thinkingMode: false,
} as const;

const CLAUDE_MODELS: ReadonlyArray<ClaudeManifestModel> = [
  {
    ...CLAUDE_MODEL_BASE,
    choice: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    runtimeIds: ["opus", "opus-5.5", "claude-opus-5-5"],
    status: "current",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"],
    defaultEffort: "medium",
  },
  {
    ...CLAUDE_MODEL_BASE,
    choice: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    runtimeIds: ["sonnet", "claude-sonnet-5"],
    status: "current",
    isDefault: true,
    efforts: ["low", "medium", "high", "xhigh", "max", "ultrathink"],
    defaultEffort: "high",
  },
  {
    ...CLAUDE_MODEL_BASE,
    choice: "claude-opus-4-5",
    label: "Claude Opus 4.5",
    runtimeIds: ["claude-opus-4-5"],
    status: "legacy",
    efforts: ["low", "medium", "high", "max"],
    defaultEffort: "medium",
    contextWindows: [],
    defaultContext: null,
  },
  {
    ...CLAUDE_MODEL_BASE,
    choice: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    runtimeIds: ["claude-haiku-4-5"],
    status: "legacy",
    efforts: [],
    defaultEffort: "default",
    contextWindows: [],
    defaultContext: null,
  },
];

const CODEX_MODELS: ReadonlyArray<CodexCatalogModel> = [
  {
    id: "gpt-6.1-sol",
    label: "GPT-6.1-Sol",
    description: "Frontier model.",
    status: "current",
    isDefault: true,
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "low",
    upgradeTo: null,
  },
  {
    id: "gpt-6-luna",
    label: "GPT-6-Luna",
    description: "Fast model.",
    status: "current",
    isDefault: false,
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    upgradeTo: null,
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    description: "Previous model.",
    status: "legacy",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
    upgradeTo: "gpt-6.1-sol",
  },
];

export const NEW_THREAD_CLAUDE_CATALOG: ClaudeModelManifest = {
  version: 1,
  updatedAt: "2026-10-01",
  claudeCode: CLAUDE_MODELS,
};

export const NEW_THREAD_GATED_CLAUDE_MIN_VERSION = "2.0.0";

export const NEW_THREAD_GATED_CLAUDE_CATALOG: ClaudeModelManifest = {
  ...NEW_THREAD_CLAUDE_CATALOG,
  claudeCode: CLAUDE_MODELS.map((model) =>
    model.choice === "claude-opus-5-5"
      ? { ...model, minVersion: NEW_THREAD_GATED_CLAUDE_MIN_VERSION }
      : model,
  ),
};

export const NEW_THREAD_CODEX_CATALOG: CodexModelCatalog = {
  version: 1,
  source: "bundled",
  revision: 1,
  models: CODEX_MODELS,
};

export function newThreadModelContextFixture(
  overrides: Partial<AgentNewThreadModelContext> = {},
): AgentNewThreadModelContext {
  return {
    claudeCatalog: NEW_THREAD_CLAUDE_CATALOG,
    codexCatalog: NEW_THREAD_CODEX_CATALOG,
    configuredModel: { claudeCode: null, codex: null },
    providerVersion: { claudeCode: null, codex: null },
    ...overrides,
  };
}

export function newThreadProviderViewFixture(
  overrides: Partial<AgentProviderManagementView> = {},
): AgentProviderManagementView {
  return {
    executable: { kind: "detected", path: "/bin/agent", version: "9.9.9" },
    health: {
      kind: "ready",
      installedVersion: "9.9.9",
      auth: { kind: "signedIn", label: null },
      update: { kind: "current", installedVersion: "9.9.9" },
      checkedAtEpochMs: 1,
    },
    policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
    updateState: { kind: "idle" },
    liveTurnCount: 0,
    ...overrides,
  };
}

export function newThreadManagementFixture(
  views: Partial<Record<AgentCliKind, AgentProviderManagementView>> = {},
  cliDiscovery: AgentCliDiscoveryResult = defaultAgentCliDiscoveryResult(),
): AgentProviderManagementSurface {
  return {
    cliDiscovery,
    providers: {
      claudeCode: views.claudeCode ?? newThreadProviderViewFixture(),
      codex: views.codex ?? newThreadProviderViewFixture(),
    },
    selectedProviderAuthority: null,
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 0,
      disposition: { kind: "policyUnavailable", reason: "unregistered" },
    }),
    authority: () => null,
    dismissToast: () => undefined,
    dismissUpdate: async () => false,
    refresh: async () => undefined,
    refreshAll: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => false,
    saveWithOutcome: async () => ({ kind: "rejected", reason: "notHydrated" }),
    update: async () => "policyUnavailable",
  };
}
