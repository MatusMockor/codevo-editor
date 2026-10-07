import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { SpeechDictationMeterStore } from "../../../application/speechDictationMeterStore";
import type {
  AudioCaptureHandle,
  SpeechDictationPorts,
} from "../../../application/speechDictationPorts";
import { useSpeechDictation } from "../../../application/useSpeechDictation";
import {
  isSpeechDictationActive,
  type SpeechDictationState,
  type SpeechLanguage,
} from "../../../domain/speechDictation";
import { insertSpeechTranscript } from "../../../domain/speechTranscriptInsertion";
import { useLatest } from "../../../ui/foundation/useLatest";
import { agentEscapeIsUnclaimed, agentSurfaceIsInteractive } from "../agentConversationEscape";
import { useAgentDictationEnvironment } from "./agentDictationContext";
import {
  agentDictationControlView,
  agentDictationDisabledReason,
  agentDictationExplanationText,
  agentDictationNoticeView,
  agentDictationSubmitBlockedReason,
  agentDictationToggleAction,
  dismissAgentDictationAftermath,
  initialAgentDictationAftermath,
  observeAgentDictationAftermath,
  type AgentDictationControlView,
  type AgentDictationExplanation,
  type AgentDictationNoticeView,
  type AgentDictationStartRefusal,
} from "./agentDictationPresentation";

export interface AgentComposerDictationOptions {
  readonly ownerKey: string;
  readonly prompt: string;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly blockedReason: string | null;
  readonly suspended: boolean;
  onPromptChange(next: string): void;
}

export type AgentComposerDictation = Readonly<{
  available: boolean;
  state: SpeechDictationState;
  meter: SpeechDictationMeterStore;
  control: AgentDictationControlView;
  notice: AgentDictationNoticeView | null;
  submitBlockedReason: string | null;
  toggle: () => void;
  dismiss: () => void;
  cancelOnEscape: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}>;

const UNSUPPORTED_CAPTURE: AudioCaptureHandle = {
  started: Promise.resolve({ kind: "failed", reason: "unsupported" }),
  stop: () => undefined,
};
const NO_DICTATION_PORTS: SpeechDictationPorts = {
  capture: { isSupported: () => false, start: () => UNSUPPORTED_CAPTURE },
  transcriber: { transcribe: async () => ({ kind: "failed", reason: "transcription-failed" }) },
};
const NO_DICTATION_LANGUAGE: SpeechLanguage = "en";
const NO_SPEECH_SERVERS: readonly string[] = [];

export function useAgentComposerDictation(
  options: AgentComposerDictationOptions,
): AgentComposerDictation {
  const { ownerKey, prompt, textareaRef, blockedReason, suspended, onPromptChange } = options;
  const environment = useAgentDictationEnvironment();
  const draft = useLatest({ prompt, onPromptChange });
  const insertTranscript = useCallback(
    (transcript: string): void => {
      const textarea = textareaRef.current;
      const text = textarea?.value ?? draft.current.prompt;
      const insertion = insertSpeechTranscript({
        text,
        selectionStart: textarea?.selectionStart ?? text.length,
        selectionEnd: textarea?.selectionEnd ?? text.length,
        transcript,
      });
      if (insertion.text === text) return;
      flushSync(() => draft.current.onPromptChange(insertion.text));
      if (textarea === null || textarea.value !== insertion.text) return;
      textarea.setSelectionRange(insertion.caret, insertion.caret);
    },
    [draft, textareaRef],
  );
  const { state, meter, start, stop, cancel } = useSpeechDictation({
    ownerId: ownerKey,
    serverIds: environment?.serverIds ?? NO_SPEECH_SERVERS,
    language: environment?.language ?? NO_DICTATION_LANGUAGE,
    ports: environment?.ports ?? NO_DICTATION_PORTS,
    onTranscript: insertTranscript,
  });
  const available = environment !== null;
  const visible = environment?.visible ?? false;
  const presentable = available && visible && !suspended;
  const usable = presentable && blockedReason === null;
  const active = isSpeechDictationActive(state);
  const action = usable ? agentDictationToggleAction(state) : "none";
  const disabledReason = available ? agentDictationDisabledReason(state, blockedReason) : null;
  const explains = presentable && disabledReason !== null;
  const [explanation, setExplanation] = useState<AgentDictationExplanation | null>(null);
  const explainedReason = agentDictationExplanationText(explanation, {
    ownerKey,
    disabledReason,
    action,
  });
  if (explanation !== null && explainedReason === null) setExplanation(null);
  const [observedAftermath, setAftermath] = useState(() =>
    initialAgentDictationAftermath(ownerKey, state),
  );
  const aftermath = observeAgentDictationAftermath(observedAftermath, ownerKey, state);
  if (aftermath !== observedAftermath) setAftermath(aftermath);
  const retainedNotice = aftermath.notice;
  const notice = useMemo(
    () => (available ? agentDictationNoticeView(state, explainedReason, retainedNotice) : null),
    [available, state, explainedReason, retainedNotice],
  );
  const control = useMemo(
    () => agentDictationControlView(state, blockedReason, retainedNotice),
    [state, blockedReason, retainedNotice],
  );

  useEffect(() => {
    if (!usable) {
      stop();
      return;
    }
    const stopWhenHidden = (): void => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => document.removeEventListener("visibilitychange", stopWhenHidden);
  }, [usable, stop]);

  const startRefusal = useCallback((): AgentDictationStartRefusal | null => {
    if (document.visibilityState === "hidden") return "window-hidden";
    const textarea = textareaRef.current;
    if (textarea === null || !agentSurfaceIsInteractive(textarea)) return "prompt-unavailable";
    return null;
  }, [textareaRef]);

  const toggle = useCallback((): void => {
    if (disabledReason !== null) {
      setExplanation({ kind: "disabled", reason: disabledReason });
      return;
    }
    if (action === "none") return;
    const refusal = action === "start" ? startRefusal() : null;
    if (refusal !== null) {
      setExplanation({ kind: "start-refused", ownerKey, refusal });
      return;
    }
    textareaRef.current?.focus({ preventScroll: true });
    if (action === "start") {
      start();
      return;
    }
    stop();
  }, [action, disabledReason, ownerKey, start, startRefusal, stop, textareaRef]);

  const dismiss = useCallback((): void => {
    if (explainedReason !== null || retainedNotice !== null) {
      setExplanation(null);
      setAftermath(dismissAgentDictationAftermath);
      return;
    }
    cancel();
  }, [cancel, explainedReason, retainedNotice]);

  const cancelOnEscape = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!active) return false;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) cancel();
      return true;
    },
    [active, cancel],
  );

  useEffect(() => {
    if (!active || !visible) return;
    const cancelUnclaimedEscape = (event: globalThis.KeyboardEvent): void => {
      if (!agentEscapeIsUnclaimed(event, document)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) cancel();
    };
    window.addEventListener("keydown", cancelUnclaimedEscape, true);
    return () => window.removeEventListener("keydown", cancelUnclaimedEscape, true);
  }, [active, cancel, visible]);

  const commands = environment?.commands ?? null;
  const command = useLatest({ action, explains, toggle });
  useEffect(() => {
    if (commands === null) return;
    return commands.bindDictation({
      available: () => {
        if (command.current.action === "stop") return true;
        if (command.current.action !== "start" && !command.current.explains) return false;
        return startRefusal() === null;
      },
      toggle: () => command.current.toggle(),
    });
  }, [commands, command, startRefusal]);

  return useMemo(
    () => ({
      available,
      state,
      meter,
      control,
      notice,
      submitBlockedReason: available ? agentDictationSubmitBlockedReason(state) : null,
      toggle,
      dismiss,
      cancelOnEscape,
    }),
    [available, state, meter, control, notice, toggle, dismiss, cancelOnEscape],
  );
}
