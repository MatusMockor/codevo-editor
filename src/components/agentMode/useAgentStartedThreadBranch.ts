import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentGitHistoryTarget } from "../../application/useAgentGitHistory";
import type { AgentThreadBranchMemorySurface } from "../../application/useAgentThreadBranchMemory";
import {
  useComposerBranchPicker,
  type ComposerBranchGateway,
  type ComposerBranchPicker,
} from "../../application/useComposerBranchPicker";
import {
  agentLocalCheckoutBranchMismatch,
  agentThreadBranchKey,
  type AgentLocalCheckoutBranchMismatch,
} from "../../domain/agentThreadBranchMemory";
import { agentComposerThreadBranch, type AgentComposerThreadBranch } from "./agentComposerStrip";
import { agentLiveCheckoutBranch, type AgentLiveCheckoutBranches } from "./agentLiveCheckoutBranch";

export interface AgentStartedThreadBranchCheckout {
  readonly gateway: ComposerBranchGateway;
  readonly guard: (target: AgentGitHistoryTarget) => string | null;
}

export interface AgentStartedThreadBranchInput {
  readonly thread: AgentThreadView | null;
  readonly checkout: AgentStartedThreadBranchCheckout | null;
  readonly memory: AgentThreadBranchMemorySurface | null;
  readonly liveCheckoutBranches: AgentLiveCheckoutBranches | null | undefined;
}

export interface AgentBranchChangedNoticeView {
  readonly mismatch: AgentLocalCheckoutBranchMismatch;
  readonly restoring: boolean;
  readonly error: string | null;
  restore(): void;
  dismiss(): void;
}

export interface AgentStartedThreadBranch {
  readonly branch: AgentComposerThreadBranch;
  readonly picker: ComposerBranchPicker | null;
  readonly currentBranch: string | null;
  readonly notice: AgentBranchChangedNoticeView | null;
}

const MAX_DISMISSED_NOTICES = 64;
const UNAVAILABLE_REASON = "Branch switching is unavailable in this view.";

export function useAgentStartedThreadBranch({
  checkout,
  liveCheckoutBranches,
  memory,
  thread,
}: AgentStartedThreadBranchInput): AgentStartedThreadBranch {
  const branch = useStableThreadBranch(thread);
  const live = branch.kind === "live" ? branch : null;
  const ownerKey = live === null ? null : agentThreadBranchKey(live.identity);
  const repositoryRoot = live?.repositoryRoot ?? null;
  const latestOwnerKey = useRef(ownerKey);
  useLayoutEffect(() => {
    latestOwnerKey.current = ownerKey;
  }, [ownerKey]);
  const remember = memory?.remember ?? null;
  const onCheckedOut = useMemo(() => {
    if (live === null || remember === null) return undefined;
    const identity = live.identity;
    const capturedKey = agentThreadBranchKey(identity);
    return (current: string | null): void => {
      if (current === null || latestOwnerKey.current !== capturedKey) return;
      remember(identity, current);
    };
  }, [live, remember]);
  const picker = useComposerBranchPicker({
    gateway: checkout?.gateway ?? null,
    guard: checkout?.guard ?? unavailable,
    onCheckedOut,
    target:
      ownerKey === null || repositoryRoot === null || checkout === null
        ? null
        : { ownerKey, repositoryRoot },
  });
  const liveBranch = agentLiveCheckoutBranch(liveCheckoutBranches, repositoryRoot);
  const currentBranch = picker.list.kind === "ready" ? picker.list.branches.current : liveBranch;
  const running = live?.running ?? false;
  const load = picker.load;
  const refreshable = ownerKey !== null && checkout !== null;
  useEffect(() => {
    if (!refreshable) return;
    load();
  }, [liveBranch, load, ownerKey, refreshable, running]);
  useEffect(() => {
    if (!refreshable) return;
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load, refreshable]);
  const notice = useBranchChangedNotice(live, memory, currentBranch, picker);
  const exposedPicker = refreshable ? picker : null;
  return useMemo(
    () => ({ branch, picker: exposedPicker, currentBranch, notice }),
    [branch, currentBranch, exposedPicker, notice],
  );
}

function useStableThreadBranch(thread: AgentThreadView | null): AgentComposerThreadBranch {
  const next = agentComposerThreadBranch(thread);
  const kind = next.kind;
  const threadId = next.kind === "live" ? next.identity.threadId : null;
  const rootKey = next.kind === "live" ? next.identity.rootKey : null;
  const ownerId = next.kind === "live" ? next.identity.ownerId : null;
  const repositoryRoot = next.kind === "live" ? next.repositoryRoot : null;
  const running = next.kind === "live" ? next.running : false;
  const worktreeBranch = next.kind === "worktree" ? next.branch : null;
  const detail = next.kind === "worktree" ? next.detail : null;
  return useMemo<AgentComposerThreadBranch>(() => {
    if (kind === "worktree") return { kind, branch: worktreeBranch, detail };
    if (
      kind === "none" ||
      threadId === null ||
      rootKey === null ||
      ownerId === null ||
      repositoryRoot === null
    ) {
      return { kind: "none" };
    }
    return {
      kind,
      identity: { threadId, rootKey, ownerId },
      repositoryRoot,
      running,
    };
  }, [detail, kind, ownerId, repositoryRoot, rootKey, running, threadId, worktreeBranch]);
}

function useBranchChangedNotice(
  live: Extract<AgentComposerThreadBranch, { kind: "live" }> | null,
  memory: AgentThreadBranchMemorySurface | null,
  currentBranch: string | null,
  picker: ComposerBranchPicker,
): AgentBranchChangedNoticeView | null {
  const [dismissed, setDismissed] = useState<ReadonlyArray<string>>([]);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [restoreFailure, setRestoreFailure] = useState<RestoreFailure | null>(null);
  const threadBranch = live === null || memory === null ? null : memory.branchOf(live.identity);
  const mismatch =
    live === null
      ? null
      : agentLocalCheckoutBranchMismatch({
          isolation: "in-place",
          worktreePath: null,
          remote: false,
          threadBranch,
          currentBranch,
        });
  const from = mismatch?.threadBranch ?? null;
  const to = mismatch?.currentBranch ?? null;
  const key =
    live === null || from === null || to === null
      ? null
      : JSON.stringify([agentThreadBranchKey(live.identity), from, to]);
  const { pending, switchToLocal } = picker;
  const restore = useCallback(() => {
    if (key === null || from === null) return;
    setRestoringKey(key);
    setRestoreFailure(null);
    void switchToLocal(from).then((result) => {
      setRestoringKey((current) => (current === key ? null : current));
      if (result.kind !== "refused") return;
      setRestoreFailure({ key, reason: result.reason });
    });
  }, [from, key, switchToLocal]);
  const dismiss = useCallback(() => {
    if (key === null) return;
    setDismissed((current) =>
      current.includes(key) ? current : [...current, key].slice(-MAX_DISMISSED_NOTICES),
    );
  }, [key]);
  const hidden = key === null || dismissed.includes(key);
  const restoring = restoringKey !== null && restoringKey === key && pending;
  const error =
    restoreFailure !== null && restoreFailure.key === key ? restoreFailure.reason : null;
  return useMemo(() => {
    if (hidden || from === null || to === null) return null;
    return {
      mismatch: { threadBranch: from, currentBranch: to },
      restoring,
      error,
      restore,
      dismiss,
    };
  }, [dismiss, error, from, hidden, restore, restoring, to]);
}

interface RestoreFailure {
  readonly key: string;
  readonly reason: string;
}

function unavailable(): string {
  return UNAVAILABLE_REASON;
}
