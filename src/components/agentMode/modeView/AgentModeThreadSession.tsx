import type { ComponentProps } from "react";
import type {
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../../../application/agentArtifactPorts";
import { deferredFollowUpsForThread } from "../../../application/agentDeferredFollowUps";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import { agentThreadIsSteerable } from "../../../application/agentTurnAdmission";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import { AgentThreadFindBar } from "../AgentThreadFindBar";
import { AgentThreadSession } from "../AgentThreadSession";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import type { AgentModeAgents } from "./agentModeViewProps";
import type { AgentModeActivity } from "./useAgentModeActivity";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeSurface } from "./useAgentModeSurface";
import type { AgentModeThreadMenu } from "./useAgentModeThreadMenu";

export interface AgentModeThreadSessionProps {
  readonly agents: AgentModeAgents;
  readonly navigation: AgentThreadNavigation;
  readonly composerState: AgentModeComposer;
  readonly surfaceState: AgentModeSurface;
  readonly threadMenu: AgentModeThreadMenu;
  readonly activity: AgentModeActivity;
  readonly sessionThread: AgentThreadView | null;
  readonly awaiting: ComponentProps<typeof AgentThreadSession>["awaiting"];
  readonly artifactLoader: AgentArtifactLoader | null;
  readonly artifactPreview: AgentArtifactPreviewPort | null;
  readonly goToTurnSignal: number;
  readonly composerRepositoryLabel: ComponentProps<
    typeof AgentThreadSession
  >["composerRepositoryLabel"];
  readonly textClipboard: TextClipboardGateway | null;
}

export function AgentModeThreadSession({
  agents,
  navigation,
  composerState,
  surfaceState,
  threadMenu,
  activity,
  sessionThread,
  awaiting,
  artifactLoader,
  artifactPreview,
  goToTurnSignal,
  composerRepositoryLabel,
  textClipboard,
}: AgentModeThreadSessionProps) {
  const { find } = navigation;
  const { composer, queuedEdit, sessionBackground } = composerState;
  const { diffScopes, serverPorts, reviewInDiff } = surfaceState;
  return (
    <AgentThreadSession
      activeDiffTurnId={diffScopes.activeDiffTurnId}
      awaiting={awaiting}
      history={agents.history}
      importedHistory={
        sessionThread === null
          ? undefined
          : agents.externalHistory?.pages?.get(sessionThread.thread.threadId)
      }
      hasEarlierImportedHistory={
        sessionThread === null
          ? false
          : agents.externalHistory?.hasEarlier?.get(sessionThread.thread.threadId)
      }
      onEarlierImportedHistory={
        sessionThread === null || agents.externalHistory?.loadEarlier === undefined
          ? undefined
          : () => {
              void agents.externalHistory?.loadEarlier?.(sessionThread.thread.threadId);
            }
      }
      artifactLoader={artifactLoader}
      artifactPreview={artifactPreview}
      localFileLinks={threadMenu.localFileLinks}
      remoteFileLinks={threadMenu.remoteFileLinks.port}
      serverLoopback={serverPorts.serverLoopback}
      attachmentImages={agents.attachmentImages}
      inlineImages={agents.inlineImages}
      onRevealAttachment={activity.revealAttachment}
      attachmentDownloads={activity.attachmentDownloads}
      findBar={
        find.open ? (
          <AgentThreadFindBar
            currentIndex={find.hitIndex}
            hitCount={find.hits.length}
            onChangeQuery={find.setQuery}
            onClose={navigation.closeFindBar}
            onNavigate={find.navigate}
            query={find.query}
            truncated={find.truncated}
          />
        ) : null
      }
      findOpen={find.open}
      goToTurnSignal={goToTurnSignal}
      externalHistoryState={
        sessionThread === null
          ? undefined
          : agents.externalHistory?.states.get(sessionThread.thread.threadId)
      }
      onRetryExternalHistory={
        sessionThread === null || agents.externalHistory === undefined
          ? undefined
          : () => {
              void agents.externalHistory?.load(sessionThread.thread.threadId);
            }
      }
      composerRepositoryLabel={composerRepositoryLabel}
      findHitIndex={navigation.findHitIndex}
      findHits={find.open ? find.hits : undefined}
      findQuery={find.open ? find.query : undefined}
      deferredFollowUps={
        sessionThread === null
          ? undefined
          : deferredFollowUpsForThread(agents.deferredFollowUps, sessionThread.thread.threadId)
      }
      onRemoveDeferredFollowUp={agents.removeDeferredFollowUp}
      onEditDeferredFollowUp={
        sessionThread === null ||
        sessionThread.execution?.kind === "remote" ||
        !queuedEdit.supported
          ? undefined
          : queuedEdit.begin
      }
      onResumeDeferredFollowUps={agents.resumeDeferredFollowUps}
      onSendDeferredFollowUpNow={
        sessionThread !== null &&
        (sessionThread.execution?.kind === "remote"
          ? sessionThread.execution.taskSteering === true
          : agentThreadIsSteerable(sessionThread.thread))
          ? agents.sendDeferredFollowUpNow
          : undefined
      }
      onReviewInDiff={reviewInDiff}
      onStopBackground={composer.composerProps.onStopNow}
      sessionTaskControls={sessionBackground.controls}
      onStopSessionTask={sessionBackground.onStopTask}
      onEndSession={sessionBackground.onEndSession}
      pendingSend={composer.pendingSend}
      onDismissPendingSend={composer.dismissPendingSend}
      onOpenTurnDiff={diffScopes.openTurnDiff}
      turnChangesRevision={
        sessionThread
          ? (agents.getTurnChangesRevision?.(sessionThread.thread.threadId) ??
            agents.turnChangesRevision)
          : agents.turnChangesRevision
      }
      getTurnChanges={agents.getTurnChanges}
      reveal={find.reveal}
      textClipboard={textClipboard}
      thread={sessionThread}
      turnLog={agents.turnLog ?? null}
    />
  );
}
