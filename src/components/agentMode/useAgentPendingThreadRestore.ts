import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { PersistedAgentProjectSelection } from "../../domain/agentProjectSelectionSnapshot";
import type { AgentNavigationRestoreLedger } from "./agentNavigationRestoreLedger";
import { projectOwnsRememberedThread } from "./agentProjectSelectionMemory";

export interface PendingAgentThreadRestore {
  readonly projectRootKey: string;
  readonly memberProjectRootKeys: ReadonlyArray<string>;
  readonly threadId: string;
  readonly repositoryRoot: string;
}

export interface AgentRestoreScope {
  readonly projectRootKey: string;
  readonly memberProjectRootKeys: ReadonlyArray<string>;
}

export interface AgentPendingThreadRestoreOptions {
  readonly ledger: AgentNavigationRestoreLedger | null;
  readonly scope: AgentRestoreScope | null;
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly loadedProjectRootKeys: ReadonlySet<string> | undefined;
  readonly selectedThreadId: string | null;
  select(threadId: string): void;
}

export interface AgentPendingThreadRestore {
  readonly projectRootKey: string | null;
  cancel(scopeProjectRootKey?: string | null): void;
}

export type PendingRestoreOutcome = "wait" | "restore" | "missing" | "refused";

export function pendingAgentThreadRestore(
  selection: PersistedAgentProjectSelection | null,
  memberProjectRootKeys: ReadonlyArray<string> = [],
): PendingAgentThreadRestore | null {
  if (selection === null || selection.threadId === null || selection.repositoryRoot === null) {
    return null;
  }
  return {
    projectRootKey: selection.projectRootKey,
    memberProjectRootKeys,
    threadId: selection.threadId,
    repositoryRoot: selection.repositoryRoot,
  };
}

export function useAgentPendingThreadRestore({
  ledger,
  scope,
  threads,
  projects,
  loadedProjectRootKeys,
  selectedThreadId,
  select,
}: AgentPendingThreadRestoreOptions): AgentPendingThreadRestore {
  const [pending, setPending] = useState<PendingAgentThreadRestore | null>(null);
  const pendingRef = useRef<PendingAgentThreadRestore | null>(null);

  const replacePending = useCallback((next: PendingAgentThreadRestore | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const scopeProjectRootKey = scope?.projectRootKey ?? null;
  const scopeMembers = scope?.memberProjectRootKeys;
  useLayoutEffect(() => {
    if (pendingRef.current !== null || selectedThreadId !== null) return;
    if (scopeProjectRootKey === null) return;
    const recalled = ledger?.recall(scopeProjectRootKey) ?? null;
    const next = pendingAgentThreadRestore(recalled, scopeMembers ?? []);
    if (next !== null) replacePending(next);
  }, [ledger, pending, replacePending, scopeMembers, scopeProjectRootKey, selectedThreadId]);

  useLayoutEffect(() => {
    if (pending === null) return;
    if (selectedThreadId !== null) {
      ledger?.settle(pending.projectRootKey);
      replacePending(null);
      return;
    }
    const outcome = pendingRestoreOutcome(pending, threads, projects, loadedProjectRootKeys);
    if (outcome === "wait") return;
    if (outcome === "refused") ledger?.decline(pending.projectRootKey);
    if (outcome !== "refused") ledger?.settle(pending.projectRootKey);
    replacePending(null);
    if (outcome === "restore") select(pending.threadId);
  }, [
    ledger,
    loadedProjectRootKeys,
    pending,
    projects,
    replacePending,
    select,
    selectedThreadId,
    threads,
  ]);

  const cancel = useCallback(
    (scopeProjectRootKey: string | null = null) => {
      if (scopeProjectRootKey !== null) ledger?.settle(scopeProjectRootKey);
      const current = pendingRef.current;
      if (current === null) return;
      ledger?.settle(current.projectRootKey);
      replacePending(null);
    },
    [ledger, replacePending],
  );

  const projectRootKey = pending?.projectRootKey ?? null;
  return useMemo(() => ({ projectRootKey, cancel }), [cancel, projectRootKey]);
}

export function pendingRestoreOutcome(
  pending: PendingAgentThreadRestore,
  threads: ReadonlyArray<AgentThreadView>,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  loadedProjectRootKeys: ReadonlySet<string> | undefined,
): PendingRestoreOutcome {
  const owners = [pending.projectRootKey, ...pending.memberProjectRootKeys];
  const candidate = threads.find((view) => view.thread.threadId === pending.threadId);
  if (candidate === undefined) {
    const allLoaded = owners.every((rootKey) => loadedProjectRootKeys?.has(rootKey) === true);
    return allLoaded ? "missing" : "wait";
  }
  const owner = candidate.thread.owner;
  if (!owners.includes(owner.rootKey)) return "refused";
  const project = projects.find((entry) => entry.rootKey === owner.rootKey);
  if (project === undefined) return "refused";
  if (candidate.thread.archived) return "missing";
  if (owner.repositoryRoot !== pending.repositoryRoot) return "missing";
  if (!projectOwnsRememberedThread(project, candidate)) return "refused";
  if (project.origin === "closed-tab-live-tasks") return "refused";
  if (project.trust === "untrusted") return "refused";
  if (project.trust === "unknown") return "wait";
  return "restore";
}
