import { workbenchAgentViewCommandBridge } from "../../application/agentViewCommandBridge";
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
      key={workspaceRoot ?? ""}
      onReleaseProject={(projectRootKey) => void projects.releaseProject(projectRootKey)}
      onTrustProject={(projectRootKey) => void projects.trustProject(projectRootKey)}
      overflowRootPaths={projects.overflowRootPaths}
      projects={projects.projects}
      viewCommands={workbenchAgentViewCommandBridge}
      workspaceRoot={workspaceRoot}
    />
  );
}
