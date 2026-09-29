import { Settings, X } from "lucide-react";
import type {
  AgentRestartFollowUpAction,
  AgentTasksNotice,
  AgentTasksNoticeAction,
} from "../../application/agentThreadPorts";

interface AgentNoticeActionHandlers {
  onConfigure(): void;
  onRestartFollowUp?(action: AgentRestartFollowUpAction): void;
}

export function AgentNoticeBar({
  notice,
  onConfigure,
  onDismiss,
  onRestartFollowUp,
}: {
  readonly notice: AgentTasksNotice;
  onConfigure(): void;
  onDismiss(): void;
  onRestartFollowUp?(action: AgentRestartFollowUpAction): void;
}) {
  return (
    <div aria-live="polite" className={`agent-notice agent-notice--${notice.kind}`} role="status">
      <span>{notice.message}</span>
      <span className="agent-notice__spacer" />
      <AgentNoticeAction
        action={notice.action}
        onConfigure={onConfigure}
        onRestartFollowUp={onRestartFollowUp}
      />
      <button
        aria-label="Dismiss agent notice"
        className="agent-linkbutton"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden="true" size={12} />
      </button>
    </div>
  );
}

function AgentNoticeAction({
  action,
  onConfigure,
  onRestartFollowUp,
}: AgentNoticeActionHandlers & { readonly action: AgentTasksNoticeAction }) {
  if (action === null) return null;
  if (action === "configure-agent-cli") {
    return (
      <button
        aria-label="Open agent settings"
        className="agent-linkbutton"
        onClick={onConfigure}
        type="button"
      >
        <Settings aria-hidden="true" size={12} /> Settings
      </button>
    );
  }
  switch (action.kind) {
    case "restartFollowUp":
      if (onRestartFollowUp === undefined) return null;
      return (
        <button
          className="agent-linkbutton"
          onClick={() => onRestartFollowUp(action)}
          type="button"
        >
          Restart and send
        </button>
      );
    default:
      return unsupportedNoticeAction(action.kind);
  }
}

function unsupportedNoticeAction(kind: never): never {
  throw new TypeError(`Unsupported agent notice action: ${String(kind)}.`);
}
