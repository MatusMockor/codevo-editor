import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentDiffRevisionKey,
  turnDiffSource,
  workingTreeDiffSource,
  type AgentDiffLineStats,
  type AgentDiffLineStatsPort,
  type AgentDiffSource,
} from "../../../../application/rightPanel/agentDiffSources";
import type { AgentDiffRevealRequest } from "../../../../application/rightPanel/useAgentDiffSurface";
import { branchDiffSource } from "../../../../application/rightPanel/agentBranchDiffSource";
import { gitSurfaceStatusValue } from "../../../../application/rightPanel/useGitSurfaceStatus";
import {
  agentDiffScopeLabel,
  agentDiffTurnOptions,
  resolveAgentDiffScope,
  type AgentDiffTurn,
} from "../../../../domain/diffView/agentDiffScope";
import type {
  GitSurfaceStatusGateway,
  GitSurfaceTarget,
} from "../../../../domain/gitSurfaceStatus";
import { isRemoteAgentSurfaceThread } from "../../agentSurfacePolicy";
import type { AgentRightPanelContextValue } from "../agentRightPanelContext";
import type { AgentDiffScopeChoices } from "./AgentDiffSurface";

const NO_TURNS: ReadonlyArray<AgentDiffTurn> = [];
const MAX_BASE_CHOICES = 50;
const MAX_CACHED_LINE_STATS = 32;
export const WORKING_TREE_RELOAD_DELAY_MS = 400;
export const UNREADABLE_REPOSITORIES_WARNING = "Some repositories could not be read.";
export const TURN_CHANGES_UNAVAILABLE_REASON =
  "Recorded turn changes are unavailable here. Switch to Working tree to see current changes.";

export interface AgentDiffSurfaceSourceModel {
  readonly source: AgentDiffSource | null;
  readonly choices: AgentDiffScopeChoices;
  readonly scopeLabel: string;
  readonly emptyReason: string | null;
  readonly warning: string | null;
  readonly reveal: AgentDiffRevealRequest | null;
  readonly remoteWorkingTree: boolean;
  refresh(): void;
}

export function useAgentDiffSurfaceSource(
  context: AgentRightPanelContextValue,
): AgentDiffSurfaceSourceModel {
  const { agents, checkoutRoot, chrome, diffScope, target, thread } = context;
  const turns = thread?.thread.turns ?? NO_TURNS;
  const remote = isRemoteAgentSurfaceThread(thread);
  const threadId = thread?.thread.threadId ?? null;
  const revisionObject =
    threadId === null
      ? undefined
      : (agents.getTurnChangesRevision?.(threadId) ?? agents.turnChangesRevision);
  const turnRevision = agentDiffRevisionKey(revisionObject);
  const status = gitSurfaceStatusValue(context.gitStatus.load);
  const resolved = useMemo(() => resolveAgentDiffScope(diffScope, turns), [diffScope, turns]);
  const getTurnChanges = agents.getTurnChanges;
  const getTurnFileDiff = agents.getTurnFileDiff;
  const statusRevision = useCoalescedValue(
    chrome?.statusRevision ?? 0,
    WORKING_TREE_RELOAD_DELAY_MS,
  );
  const [refreshCount, setRefreshCount] = useState(0);
  const workingTreeRevision = `${statusRevision}:${refreshCount}`;
  const lineStatsCache = useRef(new Map<string, Promise<AgentDiffLineStats>>());
  const surfaceStatus = chrome?.gateways.surfaceStatus ?? null;
  const lineStats = useMemo(
    () =>
      surfaceStatus === null
        ? null
        : cachedLineStats(surfaceStatus, target, workingTreeRevision, lineStatsCache.current),
    [surfaceStatus, target, workingTreeRevision],
  );
  const gitStatusRefresh = context.gitStatus.refresh;
  const refresh = useCallback(() => {
    gitStatusRefresh();
    setRefreshCount((count) => count + 1);
  }, [gitStatusRefresh]);
  const reveal = useMemo<AgentDiffRevealRequest | null>(
    () =>
      diffScope.kind === "turn" && diffScope.revealPath !== undefined
        ? { relativePath: diffScope.revealPath }
        : null,
    [diffScope],
  );

  const source = useMemo<AgentDiffSource | null>(() => {
    switch (resolved.kind) {
      case "noTurns":
        return null;
      case "turn":
        if (threadId === null || getTurnChanges === undefined || getTurnFileDiff === undefined)
          return null;
        return turnDiffSource({
          threadId,
          turnId: resolved.turnId,
          repositoryRoot: checkoutRoot,
          revision: turnRevision,
          getTurnChanges: (id, turnId) => getTurnChanges(id, turnId),
          getTurnFileDiff: (id, turnId, path) => getTurnFileDiff(id, turnId, path),
        });
      case "workingTree":
        if (remote || chrome === null || checkoutRoot === null) return null;
        return workingTreeDiffSource({
          repositories:
            thread === null ? chrome.projectRepositories : [{ root: checkoutRoot, prefix: "" }],
          worktreePath: target?.worktreePath ?? null,
          revision: workingTreeRevision,
          git: chrome.gateways.git,
          lineStats,
        });
      case "branch":
        if (remote || chrome === null || target === null) return null;
        return branchDiffSource({
          repositoryRoot: target.repositoryRoot,
          worktreePath: target.worktreePath,
          baseRef: resolved.baseRef,
          revision: 0,
          gateway: chrome.gateways.branchDiff,
        });
    }
  }, [
    checkoutRoot,
    chrome,
    getTurnChanges,
    getTurnFileDiff,
    lineStats,
    remote,
    resolved,
    target,
    thread,
    threadId,
    turnRevision,
    workingTreeRevision,
  ]);

  const head = status?.branch ?? null;
  const defaultBase = status?.defaultBase ?? null;
  const choices: AgentDiffScopeChoices = {
    turns: threadId !== null && getTurnChanges !== undefined ? agentDiffTurnOptions(turns) : [],
    workingTree: remote ? context.legacyWorkingTreeDiff !== null : chrome !== null,
    branch:
      remote || head === null || defaultBase === null || head === defaultBase
        ? null
        : {
            head,
            defaultBase,
            bases: (status?.localBranches ?? [])
              .filter((branch) => branch !== head)
              .slice(0, MAX_BASE_CHOICES),
          },
  };
  return {
    source,
    choices,
    scopeLabel: agentDiffScopeLabel(diffScope, turns),
    emptyReason: emptyReason(resolved.kind, source),
    warning:
      resolved.kind === "workingTree" && thread === null && chrome?.unreadableRepositories === true
        ? UNREADABLE_REPOSITORIES_WARNING
        : null,
    reveal,
    remoteWorkingTree: remote && diffScope.kind === "workingTree",
    refresh,
  };
}

function emptyReason(
  resolved: ReturnType<typeof resolveAgentDiffScope>["kind"],
  source: AgentDiffSource | null,
): string | null {
  if (resolved === "noTurns")
    return "No finished turns yet. Switch to Working tree to see current changes.";
  if (resolved === "turn" && source === null) return TURN_CHANGES_UNAVAILABLE_REASON;
  return null;
}

function useCoalescedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, settled, value]);
  return settled;
}

function cachedLineStats(
  gateway: GitSurfaceStatusGateway,
  target: GitSurfaceTarget | null,
  revision: string,
  cache: Map<string, Promise<AgentDiffLineStats>>,
): AgentDiffLineStatsPort {
  const port = surfaceLineStats(gateway, target);
  return {
    lineStats(repositoryRoot, worktreePath) {
      const key = JSON.stringify([repositoryRoot, worktreePath, target, revision]);
      const known = cache.get(key);
      if (known !== undefined) return known;
      if (cache.size >= MAX_CACHED_LINE_STATS) cache.clear();
      const pending = port.lineStats(repositoryRoot, worktreePath);
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
      return pending;
    },
  };
}

function surfaceLineStats(
  gateway: GitSurfaceStatusGateway,
  target: GitSurfaceTarget | null,
): AgentDiffLineStatsPort {
  return {
    async lineStats(repositoryRoot, worktreePath) {
      const request =
        worktreePath !== null && target !== null ? target : { repositoryRoot, worktreePath: null };
      const status = await gateway.getSurfaceStatus(request);
      return { stats: status.lineStats, truncated: status.lineStatsTruncated };
    },
  };
}
