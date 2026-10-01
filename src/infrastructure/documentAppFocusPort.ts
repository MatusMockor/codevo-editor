import type { AgentAppFocusPort } from "../application/agentThreadNotificationCenter";

export function createDocumentAppFocusPort(target: Window = window): AgentAppFocusPort {
  const document = target.document;
  const isFocused = (): boolean => document.visibilityState === "visible" && document.hasFocus();
  return {
    isFocused,
    subscribe(listener) {
      let last = isFocused();
      const notify = (): void => {
        const focused = isFocused();
        if (focused === last) return;
        last = focused;
        listener(focused);
      };
      target.addEventListener("focus", notify);
      target.addEventListener("blur", notify);
      document.addEventListener("visibilitychange", notify);
      return () => {
        target.removeEventListener("focus", notify);
        target.removeEventListener("blur", notify);
        document.removeEventListener("visibilitychange", notify);
      };
    },
  };
}
