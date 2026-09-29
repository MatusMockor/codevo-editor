import { useEffect, useRef, type RefObject } from "react";
import { useLatest } from "../../ui/foundation/useLatest";
import type { AgentComposerProps } from "./AgentComposer";
import { agentConversationEscapeApplies } from "./agentConversationEscape";

export type AgentConversationEscapeSource = Pick<
  AgentComposerProps,
  "queuedEdit" | "running" | "onStop"
>;

export function agentConversationEscapeAction(
  composer: AgentConversationEscapeSource,
): (() => void) | null {
  const queuedEdit = composer.queuedEdit ?? null;
  if (queuedEdit !== null) return () => queuedEdit.onCancel();
  if (composer.running !== true) return null;
  const stop = composer.onStop;
  if (stop === undefined) return null;
  return () => stop();
}

export function useAgentConversationEscape(
  conversationRef: RefObject<HTMLElement | null>,
  onEscape: (() => void) | null,
): void {
  const onEscapeRef = useLatest(onEscape);
  const ownsLastInteractionRef = useRef(false);
  const enabled = onEscape !== null;

  useEffect(() => {
    const recordLastInteraction = (event: Event): void => {
      const conversation = conversationRef.current;
      const target = event.target;
      ownsLastInteractionRef.current =
        conversation !== null && target instanceof Node && conversation.contains(target);
    };
    document.addEventListener("pointerdown", recordLastInteraction, true);
    document.addEventListener("focusin", recordLastInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", recordLastInteraction, true);
      document.removeEventListener("focusin", recordLastInteraction, true);
    };
  }, [conversationRef]);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const conversation = conversationRef.current;
      if (conversation === null) return;
      const applies = agentConversationEscapeApplies(event, {
        conversation,
        ownsLastInteraction: ownsLastInteractionRef.current,
      });
      if (!applies) return;
      event.preventDefault();
      if (event.repeat) return;
      onEscapeRef.current?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [conversationRef, enabled, onEscapeRef]);
}
