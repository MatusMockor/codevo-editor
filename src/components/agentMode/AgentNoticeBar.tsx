import { CircleAlert, Info, Settings, TriangleAlert, X } from "lucide-react";
import type {
  AgentRestartFollowUpAction,
  AgentTasksNotice,
  AgentTasksNoticeAction,
} from "../../application/agentThreadPorts";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";

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
      <AgentNoticeIcon kind={notice.kind} />
      <span className="agent-notice__message">{notice.message}</span>
      <div className="agent-notice__actions">
        <AgentNoticeAction
          action={notice.action}
          onConfigure={onConfigure}
          onRestartFollowUp={onRestartFollowUp}
        />
        <IconButton
          icon={<X aria-hidden="true" size={14} />}
          label="Dismiss agent notice"
          onClick={onDismiss}
          size="xs"
          title="Dismiss"
        />
      </div>
    </div>
  );
}

function AgentNoticeIcon({ kind }: { readonly kind: AgentTasksNotice["kind"] }) {
  switch (kind) {
    case "info":
      return <Info aria-hidden="true" className="agent-notice__icon" size={16} />;
    case "warning":
      return <TriangleAlert aria-hidden="true" className="agent-notice__icon" size={16} />;
    case "error":
      return <CircleAlert aria-hidden="true" className="agent-notice__icon" size={16} />;
    default:
      return unsupportedNoticeKind(kind);
  }
}

function AgentNoticeAction({
  action,
  onConfigure,
  onRestartFollowUp,
}: AgentNoticeActionHandlers & { readonly action: AgentTasksNoticeAction }) {
  if (action === null) return null;
  if (action === "configure-agent-cli") {
    return (
      <Button
        aria-label="Open agent settings"
        icon={<Settings aria-hidden="true" size={14} />}
        onClick={onConfigure}
        size="sm"
        variant="ghost"
      >
        Settings
      </Button>
    );
  }
  switch (action.kind) {
    case "restartFollowUp":
      if (onRestartFollowUp === undefined) return null;
      return (
        <Button onClick={() => onRestartFollowUp(action)} size="sm" variant="ghost">
          Restart and send
        </Button>
      );
    default:
      return unsupportedNoticeAction(action.kind);
  }
}

function unsupportedNoticeKind(kind: never): never {
  throw new TypeError(`Unsupported agent notice kind: ${String(kind)}.`);
}

function unsupportedNoticeAction(kind: never): never {
  throw new TypeError(`Unsupported agent notice action: ${String(kind)}.`);
}
