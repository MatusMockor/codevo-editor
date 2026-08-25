import { boundedUtf8Text } from "./agentOutput/utf8Text";
import type { AgentThreadIntegration } from "./agentThread";
import {
  MAX_GIT_INTEGRATION_CONFLICT_FILES,
  type GitIntegrationMode,
  type GitIntegrationOutcome,
  type GitPushReceipt,
  type GitShipStatus,
} from "./gitIntegration";

export const MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES = 4_096;
export const MAX_AGENT_SHIP_FAILURE_BYTES = 1_024;

export type AgentShipIntegrationMode = GitIntegrationMode;

export type AgentShipStep = "commit" | "push" | "integrate" | "removeWorktree";

export type AgentShipResumeKind = "idle" | "committed" | "pushed" | "integrated";

export type AgentShipFailure =
  | {
      readonly step: "commit";
      readonly reason: "nothingToCommit" | "gitError";
      readonly message: string;
    }
  | {
      readonly step: "push";
      readonly reason: "noRemote" | "rejected" | "authRequired" | "gitError";
      readonly message: string;
    }
  | {
      readonly step: "integrate";
      readonly outcome: Exclude<GitIntegrationOutcome, { kind: "integrated" }>;
    }
  | {
      readonly step: "integrate";
      readonly reason: "gitError";
      readonly message: string;
    }
  | {
      readonly step: "removeWorktree";
      readonly reason: "dirty" | "gitError" | "branchNotMerged";
      readonly message: string;
    }
  | { readonly step: AgentShipStep; readonly reason: "authorityLost" };

export type AgentShipState =
  | {
      readonly kind: "idle";
      readonly status: GitShipStatus | null;
      readonly loadingStatus: boolean;
    }
  | {
      readonly kind: "committing";
      readonly status: GitShipStatus | null;
      readonly message: string;
      readonly resumeFrom: AgentShipResumeKind;
    }
  | {
      readonly kind: "committed";
      readonly status: GitShipStatus | null;
      readonly commitSha: string;
    }
  | {
      readonly kind: "pushing";
      readonly status: GitShipStatus | null;
      readonly commitSha: string | null;
      readonly resumeFrom: AgentShipResumeKind;
    }
  | {
      readonly kind: "pushed";
      readonly status: GitShipStatus | null;
      readonly receipt: GitPushReceipt;
    }
  | {
      readonly kind: "integrating";
      readonly status: GitShipStatus | null;
      readonly mode: AgentShipIntegrationMode;
      readonly resumeFrom: AgentShipResumeKind;
    }
  | {
      readonly kind: "integrated";
      readonly status: GitShipStatus | null;
      readonly mergeSha: string;
      readonly intoBranch: string;
    }
  | {
      readonly kind: "removingWorktree";
      readonly status: GitShipStatus | null;
      readonly deleteBranch: boolean;
      readonly resumeFrom: AgentShipResumeKind;
    }
  | { readonly kind: "worktreeRemoved"; readonly branchDeleted: boolean }
  | {
      readonly kind: "failed";
      readonly status: GitShipStatus | null;
      readonly failure: AgentShipFailure;
      readonly resumeFrom: AgentShipResumeKind;
    };

export type AgentShipStateKind = AgentShipState["kind"];

export type AgentShipAction =
  | { readonly kind: "statusRequested" }
  | { readonly kind: "statusLoaded"; readonly status: GitShipStatus }
  | { readonly kind: "statusFailed"; readonly message: string }
  | { readonly kind: "commitStarted"; readonly message: string }
  | {
      readonly kind: "commitSucceeded";
      readonly commitSha: string;
      readonly status: GitShipStatus;
    }
  | { readonly kind: "pushStarted" }
  | {
      readonly kind: "pushSucceeded";
      readonly receipt: GitPushReceipt;
      readonly status: GitShipStatus;
    }
  | { readonly kind: "integrateStarted"; readonly mode: AgentShipIntegrationMode }
  | {
      readonly kind: "integrateSucceeded";
      readonly mergeSha: string;
      readonly intoBranch: string;
      readonly status: GitShipStatus;
    }
  | { readonly kind: "removeStarted"; readonly deleteBranch: boolean }
  | { readonly kind: "removeSucceeded"; readonly branchDeleted: boolean }
  | { readonly kind: "stepFailed"; readonly failure: AgentShipFailure }
  | { readonly kind: "reset" };

export type AgentShipAvailability =
  { readonly kind: "available" } | { readonly kind: "blocked"; readonly reason: string };

export function initialAgentShipState(receipt: AgentThreadIntegration | null): AgentShipState {
  if (receipt === null) return { kind: "idle", status: null, loadingStatus: false };
  if (receipt.integrated !== null) {
    return {
      kind: "integrated",
      status: null,
      mergeSha: receipt.integrated.mergeSha,
      intoBranch: receipt.integrated.intoBranch,
    };
  }
  if (receipt.pushed !== null) {
    return {
      kind: "pushed",
      status: null,
      receipt: {
        remote: receipt.pushed.remote,
        branch: receipt.pushed.branch,
        compareUrl: null,
      },
    };
  }
  if (receipt.lastCommitSha !== null) {
    return { kind: "committed", status: null, commitSha: receipt.lastCommitSha };
  }
  return { kind: "idle", status: null, loadingStatus: false };
}

export function agentShipTransitionAllowed(
  state: AgentShipState,
  action: AgentShipAction,
): boolean {
  if (state.kind === "worktreeRemoved") return false;
  switch (action.kind) {
    case "statusRequested":
      return state.kind === "idle" && !state.loadingStatus;
    case "statusLoaded":
      return !isBusy(state);
    case "statusFailed":
      return state.kind === "idle" && state.loadingStatus;
    case "commitStarted":
    case "pushStarted":
    case "integrateStarted":
    case "removeStarted":
      return isStartable(state);
    case "commitSucceeded":
      return state.kind === "committing";
    case "pushSucceeded":
      return state.kind === "pushing";
    case "integrateSucceeded":
      return state.kind === "integrating";
    case "removeSucceeded":
      return state.kind === "removingWorktree";
    case "stepFailed":
      return true;
    case "reset":
      return isResettable(state);
    default:
      return unsupportedAction(action);
  }
}

export function agentShipReducer(state: AgentShipState, action: AgentShipAction): AgentShipState {
  if (!agentShipTransitionAllowed(state, action)) return state;
  switch (action.kind) {
    case "statusRequested":
      return { kind: "idle", status: agentShipStatus(state), loadingStatus: true };
    case "statusLoaded":
      return withStatus(state, action.status);
    case "statusFailed":
      return { kind: "idle", status: agentShipStatus(state), loadingStatus: false };
    case "commitStarted":
      return {
        kind: "committing",
        status: agentShipStatus(state),
        message: boundedUtf8Text(action.message, MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES),
        resumeFrom: resumeFromFor(state),
      };
    case "commitSucceeded":
      return { kind: "committed", status: action.status, commitSha: action.commitSha };
    case "pushStarted":
      return {
        kind: "pushing",
        status: agentShipStatus(state),
        commitSha: state.kind === "committed" ? state.commitSha : null,
        resumeFrom: resumeFromFor(state),
      };
    case "pushSucceeded":
      return { kind: "pushed", status: action.status, receipt: action.receipt };
    case "integrateStarted":
      return {
        kind: "integrating",
        status: agentShipStatus(state),
        mode: action.mode,
        resumeFrom: resumeFromFor(state),
      };
    case "integrateSucceeded":
      return {
        kind: "integrated",
        status: action.status,
        mergeSha: action.mergeSha,
        intoBranch: action.intoBranch,
      };
    case "removeStarted":
      return {
        kind: "removingWorktree",
        status: agentShipStatus(state),
        deleteBranch: action.deleteBranch,
        resumeFrom: resumeFromFor(state),
      };
    case "removeSucceeded":
      return { kind: "worktreeRemoved", branchDeleted: action.branchDeleted };
    case "stepFailed":
      return {
        kind: "failed",
        status: agentShipStatus(state),
        failure: boundedFailure(action.failure),
        resumeFrom: resumeFromFor(state),
      };
    case "reset":
      return { kind: "idle", status: agentShipStatus(state), loadingStatus: false };
    default:
      return unsupportedAction(action);
  }
}

export function agentShipStatus(state: AgentShipState): GitShipStatus | null {
  if (state.kind === "worktreeRemoved") return null;
  return state.status;
}

export function isAgentShipBusy(state: AgentShipState): boolean {
  return isBusy(state);
}

function withStatus(state: AgentShipState, status: GitShipStatus): AgentShipState {
  switch (state.kind) {
    case "idle":
      return { kind: "idle", status, loadingStatus: false };
    case "committed":
      return { kind: "committed", status, commitSha: state.commitSha };
    case "pushed":
      return { kind: "pushed", status, receipt: state.receipt };
    case "integrated":
      return {
        kind: "integrated",
        status,
        mergeSha: state.mergeSha,
        intoBranch: state.intoBranch,
      };
    case "failed":
      return {
        kind: "failed",
        status,
        failure: state.failure,
        resumeFrom: state.resumeFrom,
      };
    case "committing":
    case "pushing":
    case "integrating":
    case "removingWorktree":
    case "worktreeRemoved":
      return state;
    default:
      return unsupportedState(state);
  }
}

function resumeFromFor(state: AgentShipState): AgentShipResumeKind {
  switch (state.kind) {
    case "idle":
    case "committed":
    case "pushed":
    case "integrated":
      return state.kind;
    case "committing":
    case "pushing":
    case "integrating":
    case "removingWorktree":
    case "failed":
      return state.resumeFrom;
    case "worktreeRemoved":
      return "idle";
    default:
      return unsupportedState(state);
  }
}

function boundedFailure(failure: AgentShipFailure): AgentShipFailure {
  if ("outcome" in failure) {
    return { step: "integrate", outcome: boundedOutcome(failure.outcome) };
  }
  if (failure.reason === "authorityLost") return failure;
  const message = boundedUtf8Text(failure.message, MAX_AGENT_SHIP_FAILURE_BYTES);
  switch (failure.step) {
    case "commit":
      return { step: "commit", reason: failure.reason, message };
    case "push":
      return { step: "push", reason: failure.reason, message };
    case "integrate":
      return { step: "integrate", reason: failure.reason, message };
    case "removeWorktree":
      return { step: "removeWorktree", reason: failure.reason, message };
    default:
      return unsupportedFailure(failure);
  }
}

function boundedOutcome(
  outcome: Exclude<GitIntegrationOutcome, { kind: "integrated" }>,
): Exclude<GitIntegrationOutcome, { kind: "integrated" }> {
  switch (outcome.kind) {
    case "conflicted":
      return {
        kind: "conflicted",
        files: outcome.files.slice(0, MAX_GIT_INTEGRATION_CONFLICT_FILES),
        truncated: outcome.truncated || outcome.files.length > MAX_GIT_INTEGRATION_CONFLICT_FILES,
      };
    case "abortFailed":
      return {
        kind: "abortFailed",
        message: boundedUtf8Text(outcome.message, MAX_AGENT_SHIP_FAILURE_BYTES),
      };
    case "primaryDirty":
    case "primaryDetached":
    case "staleExpectation":
    case "notFastForward":
      return outcome;
    default:
      return unsupportedOutcome(outcome);
  }
}

function isBusy(state: AgentShipState): boolean {
  switch (state.kind) {
    case "committing":
    case "pushing":
    case "integrating":
    case "removingWorktree":
      return true;
    case "idle":
    case "committed":
    case "pushed":
    case "integrated":
    case "worktreeRemoved":
    case "failed":
      return false;
    default:
      return unsupportedState(state);
  }
}

function isStartable(state: AgentShipState): boolean {
  if (state.kind === "failed") return true;
  return !isBusy(state) && state.kind !== "worktreeRemoved";
}

function isResettable(state: AgentShipState): boolean {
  if (isBusy(state)) return false;
  if (state.kind === "worktreeRemoved") return false;
  if (state.kind === "idle") return state.loadingStatus;
  return true;
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported agent ship action: ${JSON.stringify(action)}.`);
}

function unsupportedState(state: never): never {
  throw new TypeError(`Unsupported agent ship state: ${JSON.stringify(state)}.`);
}

function unsupportedFailure(failure: never): never {
  throw new TypeError(`Unsupported agent ship failure: ${JSON.stringify(failure)}.`);
}

function unsupportedOutcome(outcome: never): never {
  throw new TypeError(`Unsupported agent ship integration outcome: ${JSON.stringify(outcome)}.`);
}
