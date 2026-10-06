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
  agentDictationDisabledReason,
  agentDictationNoticeView,
  agentDictationSubmitBlockedReason,
  agentDictationToggleAction,
  type AgentDictationNoticeView,
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
  blockedReason: string | null;
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
  const usable = available && visible && blockedReason === null && !suspended;
  const active = isSpeechDictationActive(state);
  const action = usable ? agentDictationToggleAction(state) : "none";
  const disabledReason = available ? agentDictationDisabledReason(state, blockedReason) : null;
  const [explained, setExplained] = useState<string | null>(null);
  if (explained !== null && explained !== disabledReason) setExplained(null);
  const explainedReason = explained === disabledReason ? explained : null;
  const notice = useMemo(
    () => (available ? agentDictationNoticeView(state, explainedReason) : null),
    [available, state, explainedReason],
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

  const startable = useCallback((): boolean => {
    const textarea = textareaRef.current;
    if (textarea === null || document.visibilityState === "hidden") return false;
    return agentSurfaceIsInteractive(textarea);
  }, [textareaRef]);

  const toggle = useCallback((): void => {
    if (disabledReason !== null) {
      setExplained(disabledReason);
      return;
    }
    if (action === "none") return;
    if (action === "start" && !startable()) return;
    textareaRef.current?.focus({ preventScroll: true });
    if (action === "start") {
      start();
      return;
    }
    stop();
  }, [action, disabledReason, start, startable, stop, textareaRef]);

  const dismiss = useCallback((): void => {
    if (explainedReason !== null) {
      setExplained(null);
      return;
    }
    cancel();
  }, [cancel, explainedReason]);

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
  const command = useLatest({ action, toggle });
  useEffect(() => {
    if (commands === null) return;
    return commands.bindDictation({
      available: () =>
        command.current.action === "stop" || (command.current.action === "start" && startable()),
      toggle: () => command.current.toggle(),
    });
  }, [commands, command, startable]);

  return useMemo(
    () => ({
      available,
      state,
      meter,
      blockedReason,
      notice,
      submitBlockedReason: available ? agentDictationSubmitBlockedReason(state) : null,
      toggle,
      dismiss,
      cancelOnEscape,
    }),
    [available, state, meter, blockedReason, notice, toggle, dismiss, cancelOnEscape],
  );
}
