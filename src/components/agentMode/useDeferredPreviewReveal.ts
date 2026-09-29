import { useCallback, useEffect, useMemo, useRef } from "react";

export const PREVIEW_REVEAL_DELAY_MS = 250;

export interface DeferredPreviewReveal {
  schedule(opened: Promise<boolean>, isCurrent: () => boolean): void;
  cancel(): void;
}

export function useDeferredPreviewReveal(
  reveal: () => void,
  ownerKey: string,
): DeferredPreviewReveal {
  const revealRef = useRef(reveal);
  const tokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    revealRef.current = reveal;
  }, [reveal]);

  const cancel = useCallback(() => {
    tokenRef.current += 1;
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel, ownerKey]);

  const schedule = useCallback(
    (opened: Promise<boolean>, isCurrent: () => boolean) => {
      cancel();
      const token = tokenRef.current;
      const windowElapsed = new Promise<void>((resolve) => {
        timerRef.current = setTimeout(resolve, PREVIEW_REVEAL_DELAY_MS);
      });
      void Promise.all([opened, windowElapsed]).then(
        ([succeeded]) => {
          if (tokenRef.current !== token) return;
          timerRef.current = null;
          if (!succeeded || !isCurrent()) return;
          revealRef.current();
        },
        () => undefined,
      );
    },
    [cancel],
  );

  return useMemo(() => ({ schedule, cancel }), [cancel, schedule]);
}
