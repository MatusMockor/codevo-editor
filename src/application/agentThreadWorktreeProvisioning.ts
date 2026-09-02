import {
  MAX_WORKTREES_PER_REPOSITORY,
  type AgentWorktreeReceipt,
  type GitWorktreeGateway,
} from "../domain/gitWorktree";
import { boundedUtf8Text, utf8ByteLength } from "../domain/agentOutput/utf8Text";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  errorMessageOf,
  failure,
  isCurrentProjectOwner,
  isCurrentTaskLaunchAuthority,
  type AgentProjectAuthority,
  type AgentLaunchProjectsRef,
  type AgentTaskLaunchAuthority,
  type MountedRef,
} from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";

export interface AgentThreadWorktreeDependencies {
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly onProjectDispatchTrustRejected?: (projectRootKey: string) => void;
}

export interface CreatedAgentWorktree {
  readonly receipt: AgentWorktreeReceipt;
  readonly repositoryRoot: string;
}

type WorktreeDependenciesRef = AgentLaunchProjectsRef & {
  readonly current: AgentThreadWorktreeDependencies;
};

const TRUST_REJECTION_ERROR_MARKERS = [
  "Agent tasks require a trusted repository.",
  "Agent worktrees require a trusted repository.",
] as const;
const UNTRUSTED_WORKTREE_NOTICE =
  "The agent worktree was not trusted, so the agent was not started.";
const MAX_WORKTREE_FAILURE_REASON_BYTES = 512;
const MAX_WORKTREE_FAILURE_INPUT_CODE_UNITS = 2_048;
const WORKTREE_FAILURE_TRUNCATION_MARKER = " [truncated]";

export async function createThreadWorktree(
  dependenciesRef: WorktreeDependenciesRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
  repositoryRoot: string,
  threadId: string,
): Promise<CreatedAgentWorktree | null> {
  const deps = dependenciesRef.current;
  if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot))
    return null;
  const gateway = deps.gitWorktreeGateway;
  const receipt = await attempt(() => gateway.addAgentWorktree(repositoryRoot, threadId));
  if (!receipt.ok) {
    if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot))
      return null;
    const currentDeps = dependenciesRef.current;
    const trustRejected = noteTrustRejection(currentDeps, authority, receipt.error);
    if (trustRejected) return null;
    currentDeps.reportError(AGENT_TASKS_SOURCE, receipt.error);
    currentDeps.setNotice(failure(worktreeCreationFailureNotice(receipt.error)));
    return null;
  }
  const created: CreatedAgentWorktree = { receipt: receipt.value, repositoryRoot };
  if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
    await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, created);
    return null;
  }
  if (receipt.value.trusted) return created;
  const cleaned = await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, created);
  if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot))
    return null;
  dependenciesRef.current.setNotice(
    failure(
      cleaned ? UNTRUSTED_WORKTREE_NOTICE : orphanedWorktreeNotice(UNTRUSTED_WORKTREE_NOTICE),
    ),
  );
  return null;
}

export async function compensateCreatedWorktree(
  dependenciesRef: WorktreeDependenciesRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
  created: CreatedAgentWorktree,
): Promise<boolean> {
  const removed = await attempt(() =>
    dependenciesRef.current.gitWorktreeGateway.removeWorktree(
      created.repositoryRoot,
      created.receipt.worktreePath,
      false,
    ),
  );
  if (removed.ok) return true;
  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, created.repositoryRoot)) {
    return false;
  }
  dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, removed.error);
  dependenciesRef.current.setNotice(failure(orphanedWorktreeNotice("The agent was not started.")));
  return false;
}

export function noteTrustRejection(
  deps: AgentThreadWorktreeDependencies,
  authority: AgentProjectAuthority,
  error: unknown,
): boolean {
  if (!isAgentDispatchTrustRejection(error)) return false;
  deps.onProjectDispatchTrustRejected?.(authority.rootKey);
  return true;
}

export function isAgentDispatchTrustRejection(error: unknown): boolean {
  const message = errorMessageOf(error);
  return TRUST_REJECTION_ERROR_MARKERS.some((marker) => message === marker);
}

function worktreeCreationFailureNotice(error: unknown): string {
  const capMarker = `maximum of ${MAX_WORKTREES_PER_REPOSITORY} worktrees`;
  const boundedClassifierInput = errorMessageOf(error).slice(
    0,
    MAX_WORKTREE_FAILURE_INPUT_CODE_UNITS,
  );
  if (boundedClassifierInput.includes(capMarker)) {
    return `The repository already holds the maximum of ${MAX_WORKTREES_PER_REPOSITORY} worktrees. Remove orphaned worktrees listed in the Agents panel first.`;
  }
  return `The agent worktree could not be created: ${worktreeFailureReason(error)}`;
}

function worktreeFailureReason(error: unknown): string {
  const fullMessage = errorMessageOf(error);
  const inputTruncated = fullMessage.length > MAX_WORKTREE_FAILURE_INPUT_CODE_UNITS;
  const message = fullMessage.slice(0, MAX_WORKTREE_FAILURE_INPUT_CODE_UNITS);
  let reason = "";
  let pendingSpace = false;
  let inAnsiSequence = false;
  let ansiSequencePosition = 0;

  for (const character of message) {
    const code = character.codePointAt(0) ?? 0;
    if (inAnsiSequence) {
      ansiSequencePosition += 1;
      if (ansiSequencePosition === 1) {
        if (character !== "[") inAnsiSequence = false;
        continue;
      }
      if (code >= 0x40 && code <= 0x7e) inAnsiSequence = false;
      continue;
    }
    if (code === 0x1b) {
      inAnsiSequence = true;
      ansiSequencePosition = 0;
      continue;
    }
    if (
      code <= 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      isBidiControl(code) ||
      character.trim() === ""
    ) {
      pendingSpace = reason.length > 0;
      continue;
    }
    if (pendingSpace) reason += " ";
    pendingSpace = false;
    reason += character;
  }

  const normalized = reason.trim();
  if (normalized === "") return "Git did not provide a usable reason.";
  const outputTruncated = utf8ByteLength(normalized) > MAX_WORKTREE_FAILURE_REASON_BYTES;
  if (!inputTruncated && !outputTruncated) return normalized;
  const contentBytes =
    MAX_WORKTREE_FAILURE_REASON_BYTES - utf8ByteLength(WORKTREE_FAILURE_TRUNCATION_MARKER);
  return `${boundedUtf8Text(normalized, contentBytes)}${WORKTREE_FAILURE_TRUNCATION_MARKER}`;
}

function isBidiControl(code: number): boolean {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function orphanedWorktreeNotice(prefix: string): string {
  return `${prefix} Cleanup could not be confirmed, so its worktree may remain orphaned.`;
}
