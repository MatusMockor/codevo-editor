import type { StatusBarItemVisibility } from "../../domain/settings";
import { agentAttentionExplanation } from "./agentAttentionPresentation";
import { useMemo } from "react";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import { agentCliVersionLabel } from "../../domain/agentCliVersion";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import { AgentStatusBar } from "./AgentStatusBar";
import { normalizeAgentComposerLaunch } from "./agentComposerLaunch";
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

export interface AgentStatusBarWorkbench {
  readonly agents: AgentStatusBarAgents;
  readonly workspaceSettings: { readonly statusBar: StatusBarItemVisibility };
  readonly setStatusBarItemVisibility: (
    key: keyof StatusBarItemVisibility,
    visible: boolean,
  ) => void;
  readonly workspaceRoot: string | null;
}

export interface AgentStatusBarHostProps {
  readonly workbench: AgentStatusBarWorkbench;
}

export function AgentStatusBarHost({ workbench }: AgentStatusBarHostProps) {
  const { agents, workspaceRoot, workspaceSettings, setStatusBarItemVisibility } = workbench;
  const attentionCount = useMemo(() => agentAttentionCount(agents.threads), [agents.threads]);
  const attentionExplanation = useMemo(
    () => agentAttentionExplanation(agents.threads),
    [agents.threads],
  );
  const lastUsedLaunch = agents.lastUsedLaunch;
  const launchLabel = useMemo(() => {
    const launch = resolveLaunch(lastUsedLaunch, workspaceRoot);
    return launch === null ? null : agentLaunchMetaLabel(launch);
  }, [lastUsedLaunch, workspaceRoot]);
  const cliVersionLabel = agentCliVersionLabel(agents.agentCliKind, agents.agentCliVersion);

  return (
    <AgentStatusBar
      attentionCount={attentionCount}
      attentionExplanation={attentionExplanation}
      statusBar={workspaceSettings.statusBar}
      onChangeVisibility={setStatusBarItemVisibility}
      cliVersionLabel={cliVersionLabel}
      launchLabel={launchLabel}
      liveTaskCount={agents.liveTaskCount}
      maxConcurrentAgentTasks={agents.maxConcurrentAgentTasks}
      workspaceRoot={workspaceRoot}
    />
  );
}

function resolveLaunch(
  lastUsedLaunch: AgentStatusBarAgents["lastUsedLaunch"],
  workspaceRoot: string | null,
): AgentLaunchOptions | null {
  const rootKey = normalizedWorkspaceRootKey(workspaceRoot);
  if (rootKey === "") return null;
  const launch = lastUsedLaunch(rootKey);
  return launch === null ? null : normalizeAgentComposerLaunch(launch);
}
