import { memo, type ComponentProps } from "react";
import type { AgentTasksNotice } from "../../../application/agentThreadPorts";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import { AgentComposerController } from "../AgentComposerController";
import { AgentEndSessionStandaloneBanner } from "../AgentEndSessionConfirmationBanner";
import { AgentNoticeBar } from "../AgentNoticeBar";
import { AgentRegionBoundary } from "../AgentRegionBoundary";
import { AgentThreadUndoNotice } from "../AgentThreadUndoNotice";
import { AgentUnconfirmedMessageNotice } from "../AgentUnconfirmedMessageNotice";
import { AgentQuestionAttachmentsContext } from "../composer/agentQuestionAttachmentsContext";

type ComposerControllerProps = ComponentProps<typeof AgentComposerController>;
type UndoNoticeProps = ComponentProps<typeof AgentThreadUndoNotice>;
type NoticeBarProps = ComponentProps<typeof AgentNoticeBar>;

export type AgentModeThreadFooterProps = ComposerControllerProps & {
  readonly composerVisible: boolean;
  readonly endSessionBannerVisible: boolean;
  readonly unconfirmedMessage: boolean;
  readonly undoNotification: UndoNoticeProps["notification"];
  readonly notice: AgentTasksNotice | null;
  readonly questionAttachments: ComponentProps<
    typeof AgentQuestionAttachmentsContext.Provider
  >["value"];
  readonly selectedThreadId: string | null;
  readonly selectedServerId: string | null;
  readonly textClipboard: TextClipboardGateway | null;
  onDismissUnconfirmedMessage(): void;
  onDismissUndo: UndoNoticeProps["onDismiss"];
  onUndoPausedChange: UndoNoticeProps["onPausedChange"];
  onUndo: UndoNoticeProps["onUndo"];
  onConfigureNotice: NoticeBarProps["onConfigure"];
  onDismissNotice(): void;
  onRestartFollowUp: NoticeBarProps["onRestartFollowUp"];
};

export const AgentModeThreadFooter = memo(function AgentModeThreadFooter({
  composerVisible,
  endSessionBannerVisible,
  unconfirmedMessage,
  undoNotification,
  notice,
  questionAttachments,
  selectedThreadId,
  selectedServerId,
  textClipboard,
  onDismissUnconfirmedMessage,
  onDismissUndo,
  onUndoPausedChange,
  onUndo,
  onConfigureNotice,
  onDismissNotice,
  onRestartFollowUp,
  ...composer
}: AgentModeThreadFooterProps) {
  return (
    <>
      {unconfirmedMessage && (
        <AgentUnconfirmedMessageNotice onDismiss={onDismissUnconfirmedMessage} />
      )}
      {endSessionBannerVisible && (
        <AgentEndSessionStandaloneBanner confirmation={composer.endSessionConfirmation ?? null} />
      )}
      <AgentThreadUndoNotice
        notification={undoNotification}
        onDismiss={onDismissUndo}
        onPausedChange={onUndoPausedChange}
        onUndo={onUndo}
      />
      {notice && (
        <div className="agent-thread-notice">
          <AgentNoticeBar
            notice={notice}
            onConfigure={onConfigureNotice}
            onDismiss={onDismissNotice}
            onRestartFollowUp={onRestartFollowUp}
          />
        </div>
      )}
      {composerVisible && (
        <AgentRegionBoundary
          clipboard={textClipboard}
          region="composer"
          resetKeys={[selectedThreadId, selectedServerId, composer.composerProps.draftKey]}
        >
          <AgentQuestionAttachmentsContext.Provider value={questionAttachments}>
            <AgentComposerController {...composer} />
          </AgentQuestionAttachmentsContext.Provider>
        </AgentRegionBoundary>
      )}
    </>
  );
});
