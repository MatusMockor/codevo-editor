import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { EditorDocument } from "../domain/workspace";
import { agentBranchCheckoutBlockedReason } from "./agentBranchCheckoutPolicy";

export interface AgentBranchCheckoutProject extends Pick<
  AgentProjectDescriptor,
  "rootKey" | "rootPath" | "trust"
> {
  readonly repositories: ReadonlyArray<{ readonly repositoryRoot: string }>;
}

export interface AgentBranchCheckoutThread {
  readonly projectRootKey: string;
  readonly rootPath: string;
  readonly running: boolean;
}

export interface AgentBranchCheckoutGuardState {
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly projects: ReadonlyArray<AgentBranchCheckoutProject>;
  readonly threads: ReadonlyArray<AgentBranchCheckoutThread>;
  readonly documents:
    ReadonlyArray<Pick<EditorDocument, "path" | "content" | "savedContent">> | undefined;
  readonly dispatching: boolean;
  isLiveDocumentDirty(path: string): boolean;
}

export const BRANCH_CHECKOUT_UNAVAILABLE_REASON =
  "This project is not available for branch switching.";

export function agentBranchCheckoutGuardReason(
  rootPath: string,
  state: AgentBranchCheckoutGuardState,
): string | null {
  const owners = owningProjects(rootPath, state);
  if (owners.length === 0) return BRANCH_CHECKOUT_UNAVAILABLE_REASON;
  if (owners.some((project) => project.trust !== "trusted"))
    return BRANCH_CHECKOUT_UNAVAILABLE_REASON;
  if (owners.some((project) => project.rootPath === state.workspaceRoot) && !state.workspaceTrusted)
    return BRANCH_CHECKOUT_UNAVAILABLE_REASON;
  return agentBranchCheckoutBlockedReason(
    rootPath,
    state.documents,
    state.threads,
    state.dispatching,
    state.isLiveDocumentDirty,
  );
}

function owningProjects(
  rootPath: string,
  state: AgentBranchCheckoutGuardState,
): ReadonlyArray<AgentBranchCheckoutProject> {
  const threadProjectKeys = new Set(
    state.threads
      .filter((thread) => thread.rootPath === rootPath)
      .map((thread) => thread.projectRootKey),
  );
  return state.projects.filter(
    (project) =>
      project.rootPath === rootPath ||
      project.repositories.some((repository) => repository.repositoryRoot === rootPath) ||
      threadProjectKeys.has(project.rootKey),
  );
}
