import { useEffect, useMemo, useRef } from "react";
import {
  MAX_AGENT_COMPOSER_DRAFT_BYTES,
  type AgentComposerDraftStore,
} from "../../application/agentComposerDrafts";
import { agentDraftDispatchKey } from "../../application/agentDispatchKeys";
import { mergeRestoredPrompt } from "../../application/agentQueuedMessageEdit";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import { agentThreadRequiresNewThread } from "../../domain/agentTurnFailure";
import { composerProjectOwnsRoot, type AgentComposerProjectOption } from "./agentComposerTarget";
import { agentPromptByteLength } from "./agentModePresentation";

export type AgentComposerRecoveryReason = "sessionUnavailable" | "conversationImagesTooLarge";

export type AgentComposerRecoveryOutcome = "started" | "unavailable" | "draftTooLarge";

export interface AgentComposerRecovery {
  readonly reason: AgentComposerRecoveryReason;
  readonly threadId: string;
  readonly draftKey: string;
  activate(): boolean;
}

interface Options {
  readonly selectedThread: AgentThreadView | null;
  readonly projects: readonly AgentComposerProjectOption[];
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  selectEnvironment?(projectRootKey: string): void;
}

interface RecoveryLease {
  readonly selectedThread: AgentThreadView | null;
  readonly project: AgentComposerProjectOption | undefined;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  selectEnvironment?(projectRootKey: string): void;
}

interface RecoveryPlan {
  readonly reason: AgentComposerRecoveryReason;
  readonly threadId: string;
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
}

/** An explicit fresh draft, never a fallback that claims to resume provider context. */
export function useAgentComposerRecovery({
  selectedThread,
  projects,
  startNewThread,
  selectEnvironment,
}: Options): AgentComposerRecovery | null {
  const project = projects.find(
    (candidate) => candidate.projectRootKey === selectedThread?.thread.owner.rootKey,
  );
  const lease = useMemo<RecoveryLease>(
    () => ({ selectedThread, project, startNewThread, selectEnvironment }),
    [selectedThread, project, startNewThread, selectEnvironment],
  );
  const current = useRef<object | null>(lease);
  current.current = lease;
  useEffect(() => {
    current.current = lease;
    return () => {
      current.current = null;
    };
  }, [lease]);
  return useMemo(() => {
    const plan = sessionUnavailablePlan(lease) ?? oversizedImagesPlan(lease);
    if (plan === null) return null;
    let used = false;
    return {
      reason: plan.reason,
      threadId: plan.threadId,
      draftKey: agentDraftDispatchKey(plan.projectRootKey),
      activate: () => {
        if (used || current.current !== lease) return false;
        used = true;
        lease.selectEnvironment?.(plan.projectRootKey);
        lease.startNewThread(plan.projectRootKey, plan.repositoryRoot);
        return true;
      },
    };
  }, [lease]);
}

export function agentComposerRecoveryCaption(reason: AgentComposerRecoveryReason): string {
  switch (reason) {
    case "sessionUnavailable":
      return "This session cannot be resumed. Start a new thread to keep writing. Your unsent text will be copied; the previous conversation is not carried over.";
    case "conversationImagesTooLarge":
      return "This conversation contains images larger than the API allows. Start a new thread to keep writing. Your unsent text will be copied; attachments and the previous conversation are not carried over.";
    default:
      return unsupportedReason(reason);
  }
}

export function carryAgentDraftIntoRecovery(
  drafts: AgentComposerDraftStore,
  recovery: AgentComposerRecovery,
  text: string,
): AgentComposerRecoveryOutcome {
  const merged = mergeRestoredPrompt(drafts.readDraft(recovery.draftKey), text);
  if (agentPromptByteLength(merged) > MAX_AGENT_COMPOSER_DRAFT_BYTES) return "draftTooLarge";
  if (!recovery.activate()) return "unavailable";
  drafts.writeDraft(recovery.draftKey, merged);
  return "started";
}

function sessionUnavailablePlan({ selectedThread, project }: RecoveryLease): RecoveryPlan | null {
  const execution = selectedThread?.execution;
  const thread = selectedThread?.thread;
  const latest = thread?.turns[thread.turns.length - 1];
  if (
    execution?.resume?.available !== false ||
    execution.resume.reason !== "session_unavailable" ||
    selectedThread?.lifecycle !== "settled" ||
    thread?.archived ||
    latest?.status.kind !== "stopped" ||
    latest.turnId !== execution.latestTaskId ||
    project === undefined ||
    thread === undefined
  )
    return null;
  const rootKey = remoteAgentProjectKey(
    execution.serverId,
    execution.runnerId,
    execution.projectId,
  );
  if (
    project.projectRootKey !== rootKey ||
    project.ownerId !== thread.owner.ownerId ||
    thread.owner.repositoryRoot !== rootKey
  )
    return null;
  return {
    reason: "sessionUnavailable",
    threadId: thread.threadId,
    projectRootKey: rootKey,
    repositoryRoot: rootKey,
  };
}

function oversizedImagesPlan({ selectedThread, project }: RecoveryLease): RecoveryPlan | null {
  if (selectedThread === null || project === undefined) return null;
  const thread = selectedThread.thread;
  if (!agentThreadRequiresNewThread(thread)) return null;
  const repositoryRoot = composerProjectOwnsRoot(project, thread.owner.repositoryRoot)
    ? thread.owner.repositoryRoot
    : project.rootPath;
  return {
    reason: "conversationImagesTooLarge",
    threadId: thread.threadId,
    projectRootKey: project.projectRootKey,
    repositoryRoot,
  };
}

function unsupportedReason(reason: never): never {
  throw new TypeError(`Unsupported composer recovery reason: ${String(reason)}.`);
}
