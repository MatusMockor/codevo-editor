import { createContext, useContext } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentThreadScripts } from "../../../application/useAgentThreadScripts";
import type { AgentBranchCheckoutGateway } from "../../../application/useAgentBranchCheckout";
import type { AgentGitHistoryTarget } from "../../../application/useAgentGitHistory";
import type { GitSurfaceStatusSnapshot } from "../../../application/rightPanel/useGitSurfaceStatus";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import type { AgentDiffScope } from "../../../domain/diffView/agentDiffScope";
import type { GitSurfaceTarget } from "../../../domain/gitSurfaceStatus";
import type { AgentSurfaceDiffProps } from "../AgentSurfaceDiff";
import type { AgentSurfaceHostAgents } from "../AgentSurfaceHost";
import type { AgentShipActions } from "../useAgentShipActions";
import type { AgentSurfaceScope } from "../agentSurfacePolicy";
import type { AgentScriptsChrome } from "../agentWorkbenchChrome";
import type { AgentRightPanelChrome } from "./useAgentRightPanelChrome";

export interface AgentRightPanelCheckout {
  readonly gateway: AgentBranchCheckoutGateway;
  guard(target: AgentGitHistoryTarget): string | null;
}

export interface AgentRightPanelContextValue {
  readonly thread: AgentThreadView | null;
  readonly scope: AgentSurfaceScope;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly target: GitSurfaceTarget | null;
  readonly checkoutRoot: string | null;
  readonly chrome: AgentRightPanelChrome | null;
  readonly gitStatus: GitSurfaceStatusSnapshot;
  readonly agents: AgentSurfaceHostAgents;
  readonly shipActions: AgentShipActions | null;
  readonly checkout: AgentRightPanelCheckout | null;
  readonly historyTarget: AgentGitHistoryTarget | null;
  readonly scripts: AgentThreadScripts | null;
  readonly scriptsChrome: AgentScriptsChrome | null;
  readonly diffScope: AgentDiffScope;
  readonly legacyWorkingTreeDiff: Omit<AgentSurfaceDiffProps, "thread"> | null;
  onDiffScopeChange(scope: AgentDiffScope): void;
  openSurface(kind: AgentSurfaceKind): void;
  closeSurface(kind: AgentSurfaceKind): void;
  openFile(absolutePath: string): void;
  previewFile(absolutePath: string): void;
  revealPath(path: string): Promise<void>;
  copyText(text: string): Promise<void>;
}

export const AgentRightPanelContext = createContext<AgentRightPanelContextValue | null>(null);

export function useAgentRightPanelContext(): AgentRightPanelContextValue {
  const value = useContext(AgentRightPanelContext);
  if (value === null) throw new Error("Right panel surfaces must render inside AgentSurfaceHost.");
  return value;
}
