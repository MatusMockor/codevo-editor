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
  const ownsDetachedFocusRef = useRef(false);
  const enabled = onEscape !== null;

  useEffect(() => {
    const claimFocusOwner = (event: Event): void => {
      const conversation = conversationRef.current;
      const target = event.target;
      ownsDetachedFocusRef.current =
        conversation !== null && target instanceof Node && conversation.contains(target);
    };
    document.addEventListener("pointerdown", claimFocusOwner, true);
    document.addEventListener("focusin", claimFocusOwner, true);
    return () => {
      document.removeEventListener("pointerdown", claimFocusOwner, true);
      document.removeEventListener("focusin", claimFocusOwner, true);
    };
  }, [conversationRef]);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const conversation = conversationRef.current;
      if (conversation === null) return;
      const applies = agentConversationEscapeApplies(event, {
        conversation,
        ownsDetachedFocus: ownsDetachedFocusRef.current,
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
