import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentThreadScripts } from "../../../application/useAgentThreadScripts";
import {
  STATUS_REVISION_COALESCE_MS,
  useCoalescedValue,
} from "../../../application/rightPanel/useCoalescedValue";
import { useGitSurfaceStatus } from "../../../application/rightPanel/useGitSurfaceStatus";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import {
  effectiveAgentDiffScope,
  type AgentDiffScope,
} from "../../../domain/diffView/agentDiffScope";
import type { GitSurfaceTarget } from "../../../domain/gitSurfaceStatus";
import type { FileEntry } from "../../../domain/workspace";
import type { AgentShipActions } from "../useAgentShipActions";
import type { AgentSurfaceHostAgents } from "../AgentSurfaceHost";
import { isRemoteAgentSurfaceThread, type AgentSurfaceScope } from "../agentSurfacePolicy";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentRightPanelContextValue } from "./agentRightPanelContext";
import { useStableAgentRightPanelThread } from "./agentRightPanelThread";

const GIT_DATA_SURFACES: ReadonlyArray<AgentSurfaceKind> = ["diff", "git", "pullRequest"];

export interface AgentRightPanelContextInput {
  readonly available: boolean;
  readonly hidden: boolean;
  readonly thread: AgentThreadView | null;
  readonly threadRootPath: string | null;
  readonly scope: AgentSurfaceScope;
  readonly workspaceRoot: string | null;
  readonly chrome: AgentWorkbenchChrome;
  readonly agents: AgentSurfaceHostAgents;
  readonly openSurfaces: ReadonlyArray<AgentSurfaceKind>;
  readonly diffScope: AgentDiffScope | undefined;
  readonly shipActions: AgentShipActions | null;
  readonly checkout: AgentRightPanelContextValue["checkout"];
  readonly historyTarget: AgentRightPanelContextValue["historyTarget"];
  readonly scripts: AgentThreadScripts | null;
  readonly legacyWorkingTreeDiff: AgentRightPanelContextValue["legacyWorkingTreeDiff"];
  onDiffScopeChange(scope: AgentDiffScope): void;
  onOpenSurface(kind: AgentSurfaceKind): void;
  onCloseSurfaceTab(kind: AgentSurfaceKind): void;
}

export function useAgentRightPanelContextValue(
  input: AgentRightPanelContextInput,
): AgentRightPanelContextValue {
  const { available, chrome, scope } = input;
  const thread = useStableAgentRightPanelThread(input.thread);
  const historyTarget = useValueStable(input.historyTarget);
  const checkout = useLatestCheckout(input.checkout);
  const target = useMemo<GitSurfaceTarget | null>(() => {
    if (!available) return null;
    if (thread !== null)
      return {
        repositoryRoot: thread.thread.owner.repositoryRoot,
        worktreePath: thread.thread.target.worktreePath,
      };
    if (scope.kind !== "repository") return null;
    return { repositoryRoot: scope.repositoryRoot, worktreePath: null };
  }, [available, scope, thread]);
  const statusRevision = useCoalescedValue(
    chrome.rightPanel?.statusRevision ?? 0,
    STATUS_REVISION_COALESCE_MS,
  );
  const gitStatus = useGitSurfaceStatus({
    gateway: chrome.rightPanel?.gateways.surfaceStatus ?? null,
    target,
    revision: statusRevision,
    enabled:
      !input.hidden &&
      chrome.workspaceTrusted &&
      input.openSurfaces.some((kind) => GIT_DATA_SURFACES.includes(kind)),
  });
  const fileTree = chrome.fileTree;
  const onOpenFile = fileTree?.onOpenFile;
  const onPreviewFile = fileTree?.onPreviewFile;
  const openFile = useCallback((path: string) => onOpenFile?.(fileEntry(path)), [onOpenFile]);
  const previewFile = useCallback(
    (path: string) => onPreviewFile?.(fileEntry(path)),
    [onPreviewFile],
  );
  const rightPanel = chrome.rightPanel ?? null;
  return useMemo<AgentRightPanelContextValue>(
    () => ({
      thread,
      scope,
      workspaceRoot: input.workspaceRoot,
      workspaceTrusted: chrome.workspaceTrusted,
      target,
      checkoutRoot: checkoutRootOf(thread, scope, input.threadRootPath),
      chrome: rightPanel,
      gitStatus,
      agents: input.agents,
      shipActions: input.shipActions,
      checkout,
      historyTarget,
      scripts: input.scripts,
      scriptsChrome: chrome.scriptsSurface ?? null,
      diffScope: effectiveAgentDiffScope(
        { hasThread: thread !== null, remote: isRemoteAgentSurfaceThread(thread) },
        input.diffScope,
      ),
      legacyWorkingTreeDiff: input.legacyWorkingTreeDiff,
      onDiffScopeChange: input.onDiffScopeChange,
      openSurface: input.onOpenSurface,
      closeSurface: input.onCloseSurfaceTab,
      openFile,
      previewFile,
      revealPath: chrome.revealPath,
      copyText: rightPanel?.copyText ?? rejectCopy,
    }),
    [
      chrome.revealPath,
      chrome.scriptsSurface,
      chrome.workspaceTrusted,
      checkout,
      gitStatus,
      historyTarget,
      input.agents,
      input.diffScope,
      input.legacyWorkingTreeDiff,
      input.onCloseSurfaceTab,
      input.onDiffScopeChange,
      input.onOpenSurface,
      input.scripts,
      input.shipActions,
      input.threadRootPath,
      input.workspaceRoot,
      openFile,
      previewFile,
      rightPanel,
      scope,
      target,
      thread,
    ],
  );
}

function checkoutRootOf(
  thread: AgentThreadView | null,
  scope: AgentSurfaceScope,
  threadRootPath: string | null,
): string | null {
  if (thread !== null) return threadRootPath;
  return scope.kind === "repository" ? scope.repositoryRoot : null;
}

function fileEntry(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}

function rejectCopy(): Promise<void> {
  return Promise.reject(new Error("Copy is unavailable."));
}

function useValueStable<T>(value: T): T {
  const key = JSON.stringify(value);
  const [stable, setStable] = useState({ key, value });
  if (stable.key === key) return stable.value;
  setStable({ key, value });
  return value;
}

function useLatestCheckout(
  checkout: AgentRightPanelContextValue["checkout"],
): AgentRightPanelContextValue["checkout"] {
  const latest = useRef(checkout);
  useLayoutEffect(() => {
    latest.current = checkout;
  });
  const gateway = checkout?.gateway ?? null;
  return useMemo(
    () =>
      gateway === null
        ? null
        : {
            gateway,
            guard: (target) => latest.current?.guard(target) ?? CHECKOUT_UNAVAILABLE,
          },
    [gateway],
  );
}

const CHECKOUT_UNAVAILABLE = "This checkout is no longer available. Select it again.";
