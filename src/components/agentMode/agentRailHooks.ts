import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { THREAD_JUMP_HINT_SHOW_DELAY_MS } from "./agentSidebarPresentation";
import { agentPlatformModifier } from "./agentSubmitShortcut";

export interface AgentJumpHints {
  readonly shown: boolean;
  readonly glyph: string;
}

export function useJumpHints(): AgentJumpHints {
  const [shown, setShown] = useState(false);
  const modifier = useMemo(agentPlatformModifier, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hide = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      setShown(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== modifier.key || timer !== null) return;
      timer = setTimeout(() => setShown(true), THREAD_JUMP_HINT_SHOW_DELAY_MS);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== modifier.key) return;
      hide();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") return;
      hide();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      hide();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [modifier]);

  return useMemo(() => ({ shown, glyph: modifier.glyph }), [modifier, shown]);
}

export function useStableCallback<Args extends ReadonlyArray<unknown>>(
  handler: (...args: Args) => void,
): (...args: Args) => void {
  const ref = useRef(handler);

  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  return useCallback((...args: Args) => ref.current(...args), []);
}
