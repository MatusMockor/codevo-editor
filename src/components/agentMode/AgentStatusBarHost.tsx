import { useMemo } from "react";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import { agentCliVersionLabel } from "../../domain/agentCliVersion";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import { AgentStatusBar } from "./AgentStatusBar";
import { agentLaunchMetaLabel } from "./agentLaunchPresentation";
import { agentAttentionCount } from "./agentModePresentation";

export type AgentStatusBarAgents = Pick<
  AgentThreadsSurface,
  | "threads"
  | "liveTaskCount"
  | "maxConcurrentAgentTasks"
  | "lastUsedLaunch"
  | "agentCliKind"
  | "agentCliVersion"
>;

export interface AgentStatusBarHostProps {
  readonly agents: AgentStatusBarAgents;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}

export function AgentStatusBarHost({
  agents,
  workspaceRoot,
  workspaceTrusted,
}: AgentStatusBarHostProps) {
  const attentionCount = useMemo(() => agentAttentionCount(agents.threads), [agents.threads]);
  const lastUsedLaunch = agents.lastUsedLaunch;
  const launchLabel = useMemo(() => {
    const launch = resolveLaunch(lastUsedLaunch, workspaceRoot);
    return launch === null ? null : agentLaunchMetaLabel(launch);
  }, [lastUsedLaunch, workspaceRoot]);
  const cliVersionLabel = agentCliVersionLabel(agents.agentCliKind, agents.agentCliVersion);

  return (
    <AgentStatusBar
      attentionCount={attentionCount}
      cliVersionLabel={cliVersionLabel}
      launchLabel={launchLabel}
      liveTaskCount={agents.liveTaskCount}
      maxConcurrentAgentTasks={agents.maxConcurrentAgentTasks}
      workspaceRoot={workspaceRoot}
      workspaceTrusted={workspaceTrusted}
    />
  );
}

function resolveLaunch(
  lastUsedLaunch: AgentStatusBarAgents["lastUsedLaunch"],
  workspaceRoot: string | null,
): AgentLaunchOptions | null {
  const rootKey = normalizedWorkspaceRootKey(workspaceRoot);
  if (rootKey === "") return null;
  return lastUsedLaunch(rootKey);
}
