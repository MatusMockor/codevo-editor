import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
} from "../application/useAgentProviderManagement";
import { defaultAgentCliDiscoveryResult } from "../domain/agentSettings";

export function unconfiguredAgentProviderManagement(): AgentProviderManagementSurface {
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: unconfiguredProvider("npm i -g @anthropic-ai/claude-code"),
      codex: unconfiguredProvider("npm i -g @openai/codex"),
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
    retryRegistration: async () => undefined,
    save: async () => false,
    saveWithOutcome: async () => ({ kind: "rejected", reason: "notHydrated" }),
    update: async () => "policyUnavailable",
  };
}

function unconfiguredProvider(installCommand: string): AgentProviderManagementView {
  return {
    executable: { kind: "notFound", installCommand },
    health: { kind: "notConfigured" },
    policy: { kind: "unregistered" },
    updateState: { kind: "idle" },
    liveTurnCount: 0,
  };
}
