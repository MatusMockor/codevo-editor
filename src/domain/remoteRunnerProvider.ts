import type { AgentCliKind } from "./agentTask";
import type { RemoteRunnerProvider } from "./remoteRunner";

export function remoteRunnerProviderOf(provider: AgentCliKind): RemoteRunnerProvider {
  switch (provider) {
    case "claudeCode":
      return "claude";
    case "codex":
      return "codex";
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

export function agentCliKindOfRemoteRunnerProvider(provider: RemoteRunnerProvider): AgentCliKind {
  switch (provider) {
    case "claude":
      return "claudeCode";
    case "codex":
      return "codex";
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}
