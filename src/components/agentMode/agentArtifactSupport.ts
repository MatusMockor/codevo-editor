import { createContext, useContext } from "react";
import type {
  AgentArtifactFailureReporter,
  AgentArtifactFilePort,
} from "../../application/agentArtifactPorts";
import type { KeymapPlatform } from "../../domain/keymap";

export function agentArtifactRevealLabel(platform: KeymapPlatform): string {
  if (platform === "mac") return "Reveal in Finder";
  if (platform === "windows") return "Reveal in File Explorer";
  return "Reveal in file manager";
}

export interface AgentArtifactSupport {
  readonly files: AgentArtifactFilePort | null;
  readonly reportError: AgentArtifactFailureReporter | null;
}

export const NO_AGENT_ARTIFACT_SUPPORT: AgentArtifactSupport = Object.freeze({
  files: null,
  reportError: null,
});

const AgentArtifactSupportContext = createContext<AgentArtifactSupport>(NO_AGENT_ARTIFACT_SUPPORT);

export const AgentArtifactSupportProvider = AgentArtifactSupportContext.Provider;

export function useAgentArtifactSupport(): AgentArtifactSupport {
  return useContext(AgentArtifactSupportContext);
}
