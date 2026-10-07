import { Mic, MicOff, Square } from "lucide-react";
import { useId } from "react";
import { cx } from "../../../ui/foundation/classNames";
import { IconButton } from "../../../ui/foundation/IconButton";
import { Spinner } from "../../../ui/foundation/Spinner";
import { AgentDictationMeter } from "./AgentDictationMeter";
import {
  AGENT_DICTATION_TRANSCRIBING_LABEL,
  agentDictationInputNote,
  agentDictationStatusText,
  type AgentDictationButtonGlyph,
  type AgentDictationButtonView,
} from "./agentDictationPresentation";
import type { AgentComposerDictation } from "./useAgentComposerDictation";
import "./agentDictation.css";

export interface AgentComposerDictationControlProps {
  readonly dictation: AgentComposerDictation;
}

export function AgentComposerDictationControl({ dictation }: AgentComposerDictationControlProps) {
  if (!dictation.available) return null;
  const { control, state, notice } = dictation;
  return (
    <span
      className={cx("agent-dictation", control.kind === "hidden" && "agent-dictation--announcer")}
      data-dictation-state={state.kind}
    >
      <span aria-live="polite" className="agent-visually-hidden" role="status">
        {notice?.message ?? agentDictationStatusText(state)}
      </span>
      {control.kind === "shown" && (
        <AgentDictationMicrophone dictation={dictation} view={control.button} />
      )}
    </span>
  );
}

interface AgentDictationMicrophoneProps {
  readonly dictation: AgentComposerDictation;
  readonly view: AgentDictationButtonView;
}

function AgentDictationMicrophone({ dictation, view }: AgentDictationMicrophoneProps) {
  const reasonId = useId();
  const { state } = dictation;
  const unavailable = view.unavailableReason !== null;
  const inputNote = agentDictationInputNote(state);
  return (
    <>
      {unavailable && (
        <span className="agent-visually-hidden" id={reasonId}>
          {view.unavailableReason}
        </span>
      )}
      {state.kind === "recording" && <AgentDictationMeter meter={dictation.meter} />}
      {inputNote !== null && (
        <span className="agent-dictation__note" data-dictation-input="system-default">
          {inputNote}
        </span>
      )}
      {state.kind === "finishing" && (
        <span className="agent-dictation__note">{AGENT_DICTATION_TRANSCRIBING_LABEL}</span>
      )}
      <IconButton
        aria-busy={view.glyph === "busy" || undefined}
        aria-describedby={unavailable ? reasonId : undefined}
        aria-disabled={unavailable || undefined}
        className={cx("agent-dictation__button", view.live && "agent-dictation__button--live")}
        disabled={view.disabled}
        icon={<DictationGlyph glyph={view.glyph} />}
        label={view.label}
        onClick={dictation.toggle}
        pressed={view.pressed}
        size="round"
        title={view.title}
      />
    </>
  );
}

function DictationGlyph({ glyph }: { readonly glyph: AgentDictationButtonGlyph }) {
  switch (glyph) {
    case "microphone":
      return <Mic size={16} strokeWidth={1.5} />;
    case "microphoneOff":
      return <MicOff size={16} strokeWidth={1.5} />;
    case "stop":
      return <Square fill="currentColor" size={11} strokeWidth={1.5} />;
    case "busy":
      return <Spinner />;
    default:
      return unsupportedGlyph(glyph);
  }
}

function unsupportedGlyph(glyph: never): never {
  throw new TypeError(`Unsupported dictation glyph: ${JSON.stringify(glyph)}`);
}
