import { useEffect, type RefObject } from "react";
import { agentFocusIsClaimed, agentSurfaceIsInteractive } from "./agentConversationEscape";
import type { AgentStopConfirmationView } from "./AgentStopConfirmationBanner";

export function useAgentStopConfirmationFocus(
  confirmation: AgentStopConfirmationView["kind"] | null,
  promptRef: RefObject<HTMLTextAreaElement | null>,
): void {
  useEffect(() => {
    if (confirmation === null) return;
    const prompt = promptRef.current;
    if (prompt === null || prompt.disabled) return;
    if (prompt.ownerDocument.activeElement === prompt) return;
    if (!agentSurfaceIsInteractive(prompt)) return;
    if (agentFocusIsClaimed(prompt.ownerDocument)) return;
    prompt.focus({ preventScroll: true });
  }, [confirmation, promptRef]);
}
