import type { WorkbenchAgentsSurface } from "../../application/useWorkbenchAgents";
import { AgentModeView } from "./AgentModeView";

export interface AgentModeScreenProps {
  readonly agents: WorkbenchAgentsSurface;
  readonly workspaceRoot: string | null;
}

export function AgentModeScreen({ agents, workspaceRoot }: AgentModeScreenProps) {
  const projects = agents.agentProjects;

  return (
    <AgentModeView
      agents={agents}
      onReleaseProject={(projectRootKey) => void projects.releaseProject(projectRootKey)}
      onTrustProject={(projectRootKey) => void projects.trustProject(projectRootKey)}
      overflowRootPaths={projects.overflowRootPaths}
      projects={projects.projects}
      workspaceRoot={workspaceRoot}
    />
  );
}
