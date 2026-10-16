import { useCallback, useMemo } from "react";
import type {
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../../../application/agentArtifactPorts";
import { deferredFollowUpsForThread } from "../../../application/agentDeferredFollowUps";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import { agentThreadIsSteerable } from "../../../application/agentTurnAdmission";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { AgentThreadSessionProps } from "../AgentThreadSession";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import type { AgentModeAgents } from "./agentModeViewProps";
import type { AgentModeActivity } from "./useAgentModeActivity";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeSelectedThread } from "./useAgentModeSelectedThread";
import type { AgentModeSurface } from "./useAgentModeSurface";
import type { AgentModeThreadMenu } from "./useAgentModeThreadMenu";

export interface AgentModeSessionPropsInput {
  readonly agents: AgentModeAgents;
  readonly navigation: AgentThreadNavigation;
  readonly selected: AgentModeSelectedThread;
  readonly composerState: AgentModeComposer;
  readonly surfaceState: AgentModeSurface;
  readonly threadMenu: AgentModeThreadMenu;
  readonly activity: AgentModeActivity;
  readonly sessionThread: AgentThreadView | null;
  readonly artifactLoader: AgentArtifactLoader | null;
  readonly artifactPreview: AgentArtifactPreviewPort | null;
  readonly goToTurnSignal: number;
  readonly composerRepositoryLabel: AgentThreadSessionProps["composerRepositoryLabel"];
  readonly textClipboard: TextClipboardGateway | null;
}

export function useAgentModeSessionProps({
  agents,
  navigation,
  selected,
  composerState,
  surfaceState,
  threadMenu,
  activity,
  sessionThread,
  artifactLoader,
  artifactPreview,
  goToTurnSignal,
  composerRepositoryLabel,
  textClipboard,
}: AgentModeSessionPropsInput): AgentThreadSessionProps {
  const { composer, queuedEdit, sessionBackground } = composerState;
  const { diffScopes, serverPorts, reviewInDiff } = surfaceState;
  const threadId = sessionThread?.thread.threadId ?? null;
  const externalHistory = agents.externalHistory;
  const loadEarlier = externalHistory?.loadEarlier;
  const earlierImportedHistory = useCallback(() => {
    if (threadId === null) return;
    void loadEarlier?.(threadId);
  }, [loadEarlier, threadId]);
  const retryExternalHistory = useCallback(() => {
    if (threadId === null) return;
    void externalHistory?.load(threadId);
  }, [externalHistory, threadId]);
  const deferredFollowUps = useMemo(
    () =>
      threadId === null
        ? undefined
        : deferredFollowUpsForThread(agents.deferredFollowUps, threadId),
    [agents.deferredFollowUps, threadId],
  );
  const steerable =
    sessionThread !== null &&
    (sessionThread.execution?.kind === "remote"
      ? sessionThread.execution.taskSteering === true
      : agentThreadIsSteerable(sessionThread.thread));
  return {
    activeDiffTurnId: diffScopes.activeDiffTurnId,
    awaiting: threadId === null ? null : (selected.pendingInteractions.get(threadId) ?? null),
    history: agents.history,
    importedHistory: threadId === null ? undefined : externalHistory?.pages?.get(threadId),
    hasEarlierImportedHistory:
      threadId === null ? false : externalHistory?.hasEarlier?.get(threadId),
    onEarlierImportedHistory:
      threadId === null || loadEarlier === undefined ? undefined : earlierImportedHistory,
    artifactLoader,
    artifactPreview,
    localFileLinks: threadMenu.localFileLinks,
    remoteFileLinks: threadMenu.remoteFileLinks.port,
    serverLoopback: serverPorts.serverLoopback,
    attachmentImages: agents.attachmentImages,
    inlineImages: agents.inlineImages,
    onRevealAttachment: activity.revealAttachment,
    attachmentDownloads: activity.attachmentDownloads,
    find: navigation.find,
    onCloseFind: navigation.closeFindBar,
    goToTurnSignal,
    externalHistoryState: threadId === null ? undefined : externalHistory?.states.get(threadId),
    onRetryExternalHistory:
      threadId === null || externalHistory === undefined ? undefined : retryExternalHistory,
    composerRepositoryLabel,
    deferredFollowUps,
    onRemoveDeferredFollowUp: agents.removeDeferredFollowUp,
    onEditDeferredFollowUp:
      sessionThread === null || sessionThread.execution?.kind === "remote" || !queuedEdit.supported
        ? undefined
        : queuedEdit.begin,
    onResumeDeferredFollowUps: agents.resumeDeferredFollowUps,
    onSendDeferredFollowUpNow: steerable ? agents.sendDeferredFollowUpNow : undefined,
    onReviewInDiff: reviewInDiff,
    onStopBackground: composer.composerProps.onStopNow,
    sessionTaskControls: sessionBackground.controls,
    onStopSessionTask: sessionBackground.onStopTask,
    onEndSession: sessionBackground.onEndSession,
    pendingSend: composer.pendingSend,
    onDismissPendingSend: composer.dismissPendingSend,
    onOpenTurnDiff: surfaceState.openTurnDiff,
    turnChangesRevision:
      threadId === null
        ? agents.turnChangesRevision
        : (agents.getTurnChangesRevision?.(threadId) ?? agents.turnChangesRevision),
    getTurnChanges: agents.getTurnChanges,
    textClipboard,
    thread: sessionThread,
    turnLog: agents.turnLog ?? null,
  };
}
