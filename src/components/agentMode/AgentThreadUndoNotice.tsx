import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import type { AgentThreadUndoNotification } from "../../application/useAgentThreadUndo";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";

export const AGENT_THREAD_UNDO_BUSY_TITLE = "Finishing the previous undo";

export interface AgentThreadUndoNoticeProps {
  readonly notification: AgentThreadUndoNotification | null;
  onUndo(): void;
  onDismiss(): void;
  onPausedChange(paused: boolean): void;
}

export function AgentThreadUndoNotice({
  notification,
  onDismiss,
  onPausedChange,
  onUndo,
}: AgentThreadUndoNoticeProps) {
  return (
    <div aria-live="polite" data-slot="agent-thread-undo" role="status">
      {notification !== null && (
        <AgentThreadUndoOffer
          notification={notification}
          onDismiss={onDismiss}
          onPausedChange={onPausedChange}
          onUndo={onUndo}
        />
      )}
    </div>
  );
}

function AgentThreadUndoOffer({
  notification,
  onDismiss,
  onPausedChange,
  onUndo,
}: Omit<AgentThreadUndoNoticeProps, "notification"> & {
  readonly notification: AgentThreadUndoNotification;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  useLayoutEffect(() => {
    if (element.current?.matches(":hover") !== true) return;
    setHovered(true);
  }, []);

  useEffect(() => {
    onPausedChange(paused);
    return () => onPausedChange(false);
  }, [onPausedChange, paused]);

  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false);
  };

  return (
    <div className="agent-thread-notice">
      <div
        className="agent-notice agent-notice--info"
        onBlur={handleBlur}
        onFocus={() => setFocused(true)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        ref={element}
      >
        <span className="agent-notice__message">{notification.message}</span>
        <div className="agent-notice__actions">
          <Button
            aria-busy={notification.busy}
            disabled={notification.busy}
            onClick={onUndo}
            size="sm"
            title={notification.busy ? AGENT_THREAD_UNDO_BUSY_TITLE : undefined}
            variant="ghost"
          >
            Undo
          </Button>
          <IconButton
            icon={<X aria-hidden="true" size={14} />}
            label="Dismiss undo notice"
            onClick={onDismiss}
            size="xs"
            title="Dismiss"
          />
        </div>
      </div>
    </div>
  );
}
