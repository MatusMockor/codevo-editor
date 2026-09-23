import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import { ArrowUp, Loader2, Square } from "lucide-react";
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
        <button
          aria-label="Stop agent"
          className="agent-composer__stop"
          onClick={onStop}
          title="Stop (Esc)"
          aria-busy={dispatching || undefined}
          type="button"
        >
          {dispatching ? (
            <Loader2 aria-hidden="true" className="agent-composer__send-spinner" size={14} />
          ) : (
            <Square aria-hidden="true" size={14} strokeWidth={2.5} />
          )}
        </button>
      )}
      {(!running || enterOnly) && (
        <button
          aria-busy={dispatching || undefined}
          aria-keyshortcuts={enterOnly ? "Enter" : agentSubmitKeyShortcuts(shortcut)}
          aria-label={submitName}
          className={
            dispatching ? "agent-composer__send agent-composer__send--busy" : "agent-composer__send"
          }
          disabled={disabled}
          title={
            enterOnly
              ? `${submitName} (Enter)`
              : `${submitName} (Enter or ${shortcut.secondary.glyphs})`
          }
          type="submit"
        >
          {dispatching ? (
            <Loader2 aria-hidden="true" className="agent-composer__send-spinner" size={16} />
          ) : (
            <ArrowUp aria-hidden="true" size={16} strokeWidth={2.5} />
          )}
        </button>
      )}
    </>
  );
}
