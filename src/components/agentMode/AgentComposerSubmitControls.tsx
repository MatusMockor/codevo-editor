import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import { SubmitButton } from "../../ui/foundation/SubmitButton";
import { agentSubmitKeyShortcuts, type AgentSubmitShortcut } from "./agentSubmitShortcut";

export function AgentComposerSubmitControls({
  running,
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
  return (
    <>
      {steering && !editingQueued && (
        <button
          className="agent-composer__alternate"
          disabled={disabled || immediateBlockedReason !== null}
          aria-label={alternateName}
          aria-keyshortcuts={shortcut.secondary.keys}
          title={immediateBlockedReason ?? `${alternateName} (${shortcut.secondary.glyphs})`}
          type="button"
          onClick={onAlternate}
        >
          {alternateName}
        </button>
      )}
      {running && (
        <SubmitButton
          busy={dispatching}
          className="agent-composer__stop"
          label="Stop agent"
          mode="stop"
          onClick={onStop}
          title="Stop (Esc)"
        />
      )}
      {(!running || enterOnly) && (
        <SubmitButton
          busy={dispatching}
          className="agent-composer__send"
          disabled={disabled}
          keyShortcuts={enterOnly ? "Enter" : agentSubmitKeyShortcuts(shortcut)}
          label={submitName}
          mode={editingQueued ? "update" : "send"}
          title={
            enterOnly
              ? `${submitName} (Enter)`
              : `${submitName} (Enter or ${shortcut.secondary.glyphs})`
          }
        />
      )}
    </>
  );
}
