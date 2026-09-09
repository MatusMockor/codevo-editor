import { useLayoutEffect, useRef } from "react";

export function useAgentControlOpenRequest(
  request: object | null,
  open: () => void,
  onHandled?: () => void,
): void {
  const previous = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (request === null || previous.current === request) return;
    previous.current = request;
    open();
    onHandled?.();
  }, [request, open, onHandled]);
}
