import { useMemo } from "react";
import type { AgentQuestionApprovalGateway } from "../../../application/agentApprovalPorts";
import type { AgentTasksNotice, AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentFollowUpBehavior } from "../../../domain/agentFollowUpBehavior";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";
import type { AgentModeThreadFooterProps } from "./AgentModeThreadFooter";
import type { AgentModeRegionInputs } from "./agentModeRegionProps";

type RestartFollowUpAction = Parameters<
  NonNullable<AgentModeThreadFooterProps["onRestartFollowUp"]>
>[0];

export interface AgentModeFooterPropsInput {
  readonly regions: AgentModeRegionInputs;
  readonly sessionThread: AgentThreadView | null;
  readonly notice: AgentTasksNotice | null;
  readonly followUpBehavior: AgentFollowUpBehavior;
  readonly questionGateway: AgentQuestionApprovalGateway | null;
  dismissNotice(): void;
  onOpenMcpSettings?(): void;
}

export function useAgentModeFooterProps({
  regions,
  sessionThread,
  notice,
  followUpBehavior,
  questionGateway,
  dismissNotice,
  onOpenMcpSettings,
}: AgentModeFooterPropsInput): AgentModeThreadFooterProps {
  const {
    agents,
    navigation,
    selected,
    composerState,
    threadMenu,
    creationState,
    headerChrome,
    modelFavoritesPersistence,
    selectedServerId,
    textClipboard,
    onOpenEnvironmentSettings,
  } = regions;
  const { creation, cloneComposerVisible } = creationState;
  const { composer, composerProps, submitComposer } = composerState;
  const { threadUndo, menu } = threadMenu;
  const { composerExtras } = headerChrome;
  const { selectedThread, pendingRemoteIdentity, resolvingRemoteThread, compactionOffer } =
    selected;
  const sessionThreadId = sessionThread?.thread.threadId ?? null;
  const interactions = useMemo(
    () => ({ gateway: questionGateway, thread: sessionThread }),
    [questionGateway, sessionThread],
  );
  const dismissUnconfirmedMessage = useAgentLatestCallback(() => {
    if (sessionThreadId === null) return;
    agents.discardUnconfirmedMessage?.(sessionThreadId);
  });
  const configureNotice = useAgentLatestCallback(() => agents.configureAgentCli());
  const dismissCurrentNotice = useAgentLatestCallback(dismissNotice);
  const restartFollowUp = useAgentLatestCallback((action: RestartFollowUpAction) => {
    dismissNotice();
    void agents.restartDeferredFollowUp?.(action.threadId, action.entryId);
  });
  return {
    composerVisible: !creation.visible,
    endSessionBannerVisible: creation.visible && !cloneComposerVisible,
    unconfirmedMessage:
      sessionThreadId !== null && agents.hasUnconfirmedMessage?.(sessionThreadId) === true,
    undoNotification: threadUndo.notification,
    notice,
    questionAttachments: agents.questionAttachments ?? null,
    selectedThreadId: navigation.selectedThreadId,
    selectedServerId,
    textClipboard,
    onDismissUnconfirmedMessage: dismissUnconfirmedMessage,
    onDismissUndo: threadUndo.dismiss,
    onUndoPausedChange: threadUndo.setPaused,
    onUndo: threadUndo.undo,
    onConfigureNotice: configureNotice,
    onDismissNotice: dismissCurrentNotice,
    onRestartFollowUp: restartFollowUp,
    followUpBehavior,
    executionServerId:
      selectedThread?.execution?.serverId ??
      pendingRemoteIdentity?.serverId ??
      (resolvingRemoteThread ? "unavailable" : selectedThread === null ? selectedServerId : null),
    compactionOffer: selectedThread?.execution?.kind === "remote" ? null : compactionOffer,
    composerProps,
    modelFavoritesPersistence,
    onOpenEnvironmentSettings,
    onOpenProviderSettings: agents.configureAgentCli,
    providerManagement: agents.providerManagement,
    providerEnabled: selected.effectiveProviderEnabled,
    submissionBlocked: resolvingRemoteThread || composer.submissionBlocked,
    submit: submitComposer,
    interactions,
    banners: composerExtras.banners,
    endSessionConfirmation: menu.endSessionConfirmation,
    onShowUsageLimits: composerExtras.onShowUsageLimits,
    onOpenMcpServers: onOpenMcpSettings,
    renderDrawerEnd: composerExtras.renderDrawerEnd,
  };
}
