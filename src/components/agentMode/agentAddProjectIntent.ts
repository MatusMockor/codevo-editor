import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";

export const ADD_PROJECT_LOADING_REASON = "Reading this directory…";
export const ADD_PROJECT_UNREADABLE_REASON = "This directory could not be read.";
export const ADD_PROJECT_ALREADY_PROJECT_REASON = "This directory is already a project.";

export type AgentAddProjectListingStatus = "loading" | "loaded" | "error";

export type AgentAddProjectIntent =
  | { readonly kind: "add"; readonly rootPath: string }
  | { readonly kind: "openExisting"; readonly rootPath: string; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string };

export interface AgentAddProjectIntentInput {
  readonly status: AgentAddProjectListingStatus;
  readonly hasListing: boolean;
  readonly currentPath: string | null;
  readonly projectRootPaths: ReadonlyArray<string>;
}

export function agentAddProjectIntent({
  currentPath,
  hasListing,
  projectRootPaths,
  status,
}: AgentAddProjectIntentInput): AgentAddProjectIntent {
  if (status === "loading") return { kind: "blocked", reason: ADD_PROJECT_LOADING_REASON };
  if (status === "error" || !hasListing || currentPath === null) {
    return { kind: "blocked", reason: ADD_PROJECT_UNREADABLE_REASON };
  }

  const registered = projectRootPaths.find((root) => workspaceRootKeysEqual(root, currentPath));
  if (registered !== undefined) {
    return {
      kind: "openExisting",
      rootPath: registered,
      reason: ADD_PROJECT_ALREADY_PROJECT_REASON,
    };
  }

  return { kind: "add", rootPath: currentPath };
}

export function agentAddProjectIntentReason(intent: AgentAddProjectIntent): string | null {
  if (intent.kind === "add") return null;

  return intent.reason;
}

export function agentAddProjectActionLabel(intent: AgentAddProjectIntent): string {
  if (intent.kind === "openExisting") return "Open project";

  return "Add";
}
