import {
  workspaceRootEligibility,
  workspaceRootRefusalMessage,
  type WorkspaceHomeReference,
} from "../../domain/workspaceRootEligibility";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";

export const ADD_PROJECT_LOADING_REASON = "Reading this directory…";
export const ADD_PROJECT_UNREADABLE_REASON = "This directory could not be read.";
export const ADD_PROJECT_ALREADY_PROJECT_REASON = "This directory is already a project.";

export type AgentAddProjectListingStatus = "loading" | "loaded" | "error";

export type AgentAddProjectRootPolicy =
  | { readonly kind: "projectRoot"; readonly home: WorkspaceHomeReference }
  | { readonly kind: "anyDirectory" };

export type AgentAddProjectIntent =
  | { readonly kind: "add"; readonly rootPath: string }
  | { readonly kind: "openExisting"; readonly rootPath: string; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string };

export interface AgentAddProjectIntentInput {
  readonly status: AgentAddProjectListingStatus;
  readonly hasListing: boolean;
  readonly currentPath: string | null;
  readonly projectRootPaths: ReadonlyArray<string>;
  readonly rootPolicy: AgentAddProjectRootPolicy;
}

export function agentAddProjectIntent({
  currentPath,
  hasListing,
  projectRootPaths,
  rootPolicy,
  status,
}: AgentAddProjectIntentInput): AgentAddProjectIntent {
  if (status === "loading") return { kind: "blocked", reason: ADD_PROJECT_LOADING_REASON };
  if (status === "error" || !hasListing || currentPath === null) {
    return { kind: "blocked", reason: ADD_PROJECT_UNREADABLE_REASON };
  }

  const refusal = rootPolicyRefusal(rootPolicy, currentPath);
  if (refusal !== null) return { kind: "blocked", reason: refusal };

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
  switch (intent.kind) {
    case "add":
      return null;
    case "openExisting":
    case "blocked":
      return intent.reason;
    default: {
      const unsupported: never = intent;
      return unsupported;
    }
  }
}

export function agentAddProjectActionLabel(intent: AgentAddProjectIntent): string {
  switch (intent.kind) {
    case "openExisting":
      return "Open project";
    case "add":
    case "blocked":
      return "Add";
    default: {
      const unsupported: never = intent;
      return unsupported;
    }
  }
}

function rootPolicyRefusal(policy: AgentAddProjectRootPolicy, currentPath: string): string | null {
  switch (policy.kind) {
    case "anyDirectory":
      return null;
    case "projectRoot": {
      const eligibility = workspaceRootEligibility(currentPath, policy.home);
      if (eligibility.kind === "eligible") return null;
      return workspaceRootRefusalMessage(eligibility.reason);
    }
    default: {
      const unsupported: never = policy;
      return unsupported;
    }
  }
}
