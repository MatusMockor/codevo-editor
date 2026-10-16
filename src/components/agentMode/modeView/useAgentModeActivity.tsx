import { useCallback, useMemo } from "react";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import { AgentThreadActivity } from "../AgentThreadActivity";
import {
  agentThreadActivityDetail,
  agentThreadActivitySummary,
} from "../agentThreadActivityPresentation";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import { useAgentAttachmentDownloads } from "../useAgentAttachmentDownloads";
import { REVEAL_FAILED_NOTICE } from "../useAgentThreadMenuCommands";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";
import type { AgentModeAgents, AgentModeNoticeReporter } from "./agentModeViewProps";
import type { AgentModeSurface } from "./useAgentModeSurface";

export interface AgentModeActivityOptions {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly workspaceRoot: string | null;
  readonly surfaceState: AgentModeSurface;
  readonly setLocalNotice: AgentModeNoticeReporter;
}

export function useAgentModeActivity({
  agents,
  chrome,
  workspaceRoot,
  surfaceState,
  setLocalNotice,
}: AgentModeActivityOptions) {
  const { surface, diffScopes } = surfaceState;
  const { openSurface, toggleRightPanel } = surface;
  const { attention, attentionExplanation, capacity, live } = useMemo(
    () =>
      agentThreadActivitySummary(
        agents.threads,
        agents.liveTaskCount,
        agents.maxConcurrentAgentTasks,
      ),
    [agents.liveTaskCount, agents.maxConcurrentAgentTasks, agents.threads],
  );
  const threadActivitySummary = useMemo(
    () => ({ attention, attentionExplanation, capacity, live }),
    [attention, attentionExplanation, capacity, live],
  );
  const attentionVisible = chrome.threadActivity?.attentionVisible ?? true;
  const changeAttentionVisible = chrome.threadActivity?.onChangeAttentionVisible ?? null;
  const footerActivity = useMemo(
    () => (
      <AgentThreadActivity
        attentionVisible={attentionVisible}
        onChangeAttentionVisible={changeAttentionVisible}
        ownerKey={workspaceRoot}
        summary={threadActivitySummary}
      />
    ),
    [attentionVisible, changeAttentionVisible, threadActivitySummary, workspaceRoot],
  );
  const sidebarRevealDetail = agentThreadActivityDetail(threadActivitySummary, attentionVisible);
  const activateSurface = useAgentLatestCallback(surface.activateSurface);
  const closeSurfaceTab = useAgentLatestCallback((kind: AgentSurfaceKind) => {
    if (kind === "diff") diffScopes.resetScope();
    surface.closeSurfaceTab(kind);
  });
  const openSurfaceCommand = useAgentLatestCallback((kind: AgentSurfaceKind) => {
    if (kind === "diff") diffScopes.resetScope();
    openSurface(kind);
  });
  const toggleRightPanelCommand = useAgentLatestCallback(toggleRightPanel);
  const openAgentsSurface = useAgentLatestCallback(() => surface.openSurface("agents"));
  const toggleAgentsSurface = useAgentLatestCallback(() => surface.toggleSurface("agents"));
  const revealFailed = useCallback(() => setLocalNotice(REVEAL_FAILED_NOTICE), [setLocalNotice]);
  const revealAgentAttachment = agents.revealAttachment;
  const revealAttachment = useCallback(
    (threadId: string, attachmentId: string): void => {
      void revealAgentAttachment(threadId, attachmentId);
    },
    [revealAgentAttachment],
  );
  const attachmentDownloads = useAgentAttachmentDownloads({
    download: agents.downloadAttachment,
    reportNotice: setLocalNotice,
  });
  return {
    footerActivity,
    sidebarRevealDetail,
    activateSurface,
    closeSurfaceTab,
    openSurfaceCommand,
    toggleRightPanelCommand,
    openAgentsSurface,
    toggleAgentsSurface,
    revealFailed,
    revealAttachment,
    attachmentDownloads,
  };
}

export type AgentModeActivity = ReturnType<typeof useAgentModeActivity>;
