import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import { SubmitButton } from "../../ui/foundation/SubmitButton";
import { agentSubmitKeyShortcuts, type AgentSubmitShortcut } from "./agentSubmitShortcut";

export function AgentComposerSubmitControls({
  running,
  hasDraft,
  steering,
  editingQueued,
  dispatching,
  disabled,
  submitName,
  followUpBehavior,
  immediateBlockedReason,
  shortcut,
  onStop,
  onAlternate,
}: {
  readonly running: boolean;
  readonly hasDraft: boolean;
  readonly steering: boolean;
  readonly editingQueued: boolean;
  readonly dispatching: boolean;
  readonly disabled: boolean;
  readonly submitName: string;
  readonly followUpBehavior: AgentFollowUpBehavior;
  readonly immediateBlockedReason: string | null;
  readonly shortcut: AgentSubmitShortcut;
  readonly onStop: (() => void) | undefined;
  readonly onAlternate: () => void;
}) {
  const alternateName = followUpBehavior === "queue" ? "Send now" : "Queue message";
  const enterOnly = steering || editingQueued;
  if (running && !hasDraft && !editingQueued) {
    return (
      <SubmitButton
        busy={dispatching}
        className="agent-composer__stop"
        label="Stop agent"
        mode="stop"
        onClick={onStop}
        title="Stop (Esc)"
      />
    );
  }
  return (
    <SubmitButton
      busy={dispatching}
      className="agent-composer__send"
      disabled={disabled}
      keyShortcuts={enterOnly ? "Enter" : agentSubmitKeyShortcuts(shortcut)}
      label={submitName}
      mode={editingQueued ? "update" : "send"}
      onClick={(event) => {
        if (!steering || editingQueued || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        if (!disabled && immediateBlockedReason === null) onAlternate();
      }}
      title={
        steering && !editingQueued
          ? `${submitName} (Enter); Ctrl/⌘-click or ${shortcut.secondary.glyphs}: ${immediateBlockedReason ?? alternateName}`
          : enterOnly
            ? `${submitName} (Enter)`
            : `${submitName} (Enter or ${shortcut.secondary.glyphs})`
      }
    />
  );
}
