import type { AgentQuestionApprovalGateway } from "../../../application/agentApprovalPorts";
import type { AgentTasksNotice, AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentModelFavoritesPersistence } from "../../../application/useAgentModelFavorites";
import type { AgentFollowUpBehavior } from "../../../domain/agentFollowUpBehavior";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import { AgentComposerController } from "../AgentComposerController";
import { AgentEndSessionStandaloneBanner } from "../AgentEndSessionConfirmationBanner";
import { AgentNoticeBar } from "../AgentNoticeBar";
import { AgentRegionBoundary } from "../AgentRegionBoundary";
import { AgentThreadUndoNotice } from "../AgentThreadUndoNotice";
import { AgentUnconfirmedMessageNotice } from "../AgentUnconfirmedMessageNotice";
import { AgentQuestionAttachmentsContext } from "../composer/agentQuestionAttachmentsContext";
import type { AgentModeAgents } from "./agentModeViewProps";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeCreation } from "./useAgentModeCreation";
import type { AgentModeHeaderChrome } from "./useAgentModeHeaderChrome";
import type { AgentModeSelectedThread } from "./useAgentModeSelectedThread";
import type { AgentModeThreadMenu } from "./useAgentModeThreadMenu";

export interface AgentModeThreadFooterProps {
  readonly agents: AgentModeAgents;
  readonly selected: AgentModeSelectedThread;
  readonly composerState: AgentModeComposer;
  readonly creationState: AgentModeCreation;
  readonly threadMenu: AgentModeThreadMenu;
  readonly headerChrome: AgentModeHeaderChrome;
  readonly sessionThread: AgentThreadView | null;
  readonly notice: AgentTasksNotice | null;
  readonly followUpBehavior: AgentFollowUpBehavior;
  readonly modelFavoritesPersistence: AgentModelFavoritesPersistence | null;
  readonly questionGateway: AgentQuestionApprovalGateway | null;
  readonly selectedThreadId: string | null;
  readonly selectedServerId: string | null;
  readonly textClipboard: TextClipboardGateway | null;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  dismissNotice(): void;
  onOpenEnvironmentSettings?(): void;
  onOpenMcpSettings?(): void;
}

export function AgentModeThreadFooter({
  agents,
  selected,
  composerState,
  creationState,
  threadMenu,
  headerChrome,
  sessionThread,
  notice,
  followUpBehavior,
  modelFavoritesPersistence,
  questionGateway,
  selectedThreadId,
  selectedServerId,
  textClipboard,
  providerEnabled,
  dismissNotice,
  onOpenEnvironmentSettings,
  onOpenMcpSettings,
}: AgentModeThreadFooterProps) {
  const { creation, cloneComposerVisible } = creationState;
  const { composer, composerProps, submitComposer } = composerState;
  const { threadUndo, menu } = threadMenu;
  const { composerExtras } = headerChrome;
  const { selectedThread, pendingRemoteIdentity, resolvingRemoteThread, compactionOffer } =
    selected;
  return (
    <>
      {sessionThread !== null && agents.hasUnconfirmedMessage?.(sessionThread.thread.threadId) && (
        <AgentUnconfirmedMessageNotice
          onDismiss={() => agents.discardUnconfirmedMessage?.(sessionThread.thread.threadId)}
        />
      )}
      {creation.visible && !cloneComposerVisible && (
        <AgentEndSessionStandaloneBanner confirmation={menu.endSessionConfirmation} />
      )}
      <AgentThreadUndoNotice
        notification={threadUndo.notification}
        onDismiss={threadUndo.dismiss}
        onPausedChange={threadUndo.setPaused}
        onUndo={threadUndo.undo}
      />
      {notice && (
        <div className="agent-thread-notice">
          <AgentNoticeBar
            notice={notice}
            onConfigure={() => agents.configureAgentCli()}
            onDismiss={dismissNotice}
            onRestartFollowUp={(action) => {
              dismissNotice();
              void agents.restartDeferredFollowUp?.(action.threadId, action.entryId);
            }}
          />
        </div>
      )}
      {!creation.visible && (
        <AgentRegionBoundary
          clipboard={textClipboard}
          region="composer"
          resetKeys={[selectedThreadId, selectedServerId, composerProps.draftKey]}
        >
          <AgentQuestionAttachmentsContext.Provider value={agents.questionAttachments ?? null}>
            <AgentComposerController
              followUpBehavior={followUpBehavior}
              executionServerId={
                selectedThread?.execution?.serverId ??
                pendingRemoteIdentity?.serverId ??
                (resolvingRemoteThread
                  ? "unavailable"
                  : selectedThread === null
                    ? selectedServerId
                    : null)
              }
              compactionOffer={
                selectedThread?.execution?.kind === "remote" ? null : compactionOffer
              }
              composerProps={composerProps}
              modelFavoritesPersistence={modelFavoritesPersistence}
              onOpenEnvironmentSettings={onOpenEnvironmentSettings}
              onOpenProviderSettings={agents.configureAgentCli}
              providerManagement={agents.providerManagement}
              providerEnabled={providerEnabled}
              submissionBlocked={resolvingRemoteThread || composer.submissionBlocked}
              submit={submitComposer}
              interactions={{ gateway: questionGateway, thread: sessionThread }}
              banners={composerExtras.banners}
              endSessionConfirmation={menu.endSessionConfirmation}
              onShowUsageLimits={composerExtras.onShowUsageLimits}
              onOpenMcpServers={onOpenMcpSettings}
              renderDrawerEnd={composerExtras.renderDrawerEnd}
            />
          </AgentQuestionAttachmentsContext.Provider>
        </AgentRegionBoundary>
      )}
    </>
  );
}
