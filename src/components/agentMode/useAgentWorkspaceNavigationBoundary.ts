import { useRef } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";
import type { AgentProjectWorkspaceActivation } from "./useAgentProjectWorkspaceSync";

export function useAgentWorkspaceNavigationBoundary(
  workspaceRoot: string | null,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  activation: AgentProjectWorkspaceActivation,
  addingProjectRoot: string | null,
  session: AgentNavigationSession,
) {
  const state = useRef({ workspaceRoot, externalRoot: null as string | null, revision: 0 });
  const current = state.current;
  let cancelPendingAdd = false;
  if (current.workspaceRoot !== workspaceRoot) {
    const internal =
      (addingProjectRoot !== null && addingProjectRoot === workspaceRoot) ||
      ((activation.kind === "pending" || activation.kind === "ready") &&
        activation.rootPath === workspaceRoot);
    current.workspaceRoot = workspaceRoot;
    current.externalRoot = null;
    if (!internal) {
      cancelPendingAdd = addingProjectRoot !== null;
      current.externalRoot = workspaceRoot;
      current.revision += 1;
      session.current = {
        selectedThreadId: null,
        selectedThreadOwnerKey: null,
        scopeState: NO_SCOPE_STATE,
      };
    }
  }
  if (current.externalRoot !== null) {
    const project = projects.find(
      (candidate) =>
        candidate.rootPath === current.externalRoot && candidate.origin !== "closed-tab-live-tasks",
    );
    if (project !== undefined) {
      session.current = {
        selectedThreadId: null,
        selectedThreadOwnerKey: null,
        scopeState: {
          intent: "automatic",
          railScope: { projectRootKey: project.rootKey, repositoryRoot: project.rootPath },
          authority: { ownerId: project.ownerId, generation: project.generation },
          order: [],
        },
      };
      current.externalRoot = null;
      current.revision += 1;
    }
  }
  return {
    key: `${workspaceRoot ?? ""}:${current.revision}`,
    pendingExternalRoot: current.externalRoot,
    cancelPendingAdd,
  };
}
