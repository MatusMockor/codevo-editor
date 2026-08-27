import { useEffect, useState, type RefObject } from "react";

export const COMPACT_COMPOSER_QUERY = "(max-width: 620px)";
const COMPACT_COMPOSER_MAX_INLINE_SIZE = 620;

export function useCompactComposerControls(
  ownerRef: RefObject<HTMLElement | null> | null = null,
): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const owner = { active: true };
    const ownerElement = ownerRef?.current ?? null;
    const center = ownerElement?.closest<HTMLElement>(".agent-mode__center") ?? null;
    const media =
      typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_COMPOSER_QUERY) : null;
    const update = (): void => {
      if (!owner.active) return;
      if (center === null) {
        setCompact(media?.matches ?? false);
        return;
      }
      if (!center.isConnected) return;
      if (ownerElement?.closest(".agent-mode__center") !== center) return;
      const inlineSize = center.getBoundingClientRect().width;
      if (inlineSize > 0) {
        setCompact(inlineSize <= COMPACT_COMPOSER_MAX_INLINE_SIZE);
        return;
      }
      setCompact(media?.matches ?? false);
    };
    update();
    const observer =
      center !== null && typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    if (observer !== null && center !== null) observer.observe(center);
    media?.addEventListener("change", update);
    return () => {
      owner.active = false;
      observer?.disconnect();
      media?.removeEventListener("change", update);
    };
  }, [ownerRef]);

  return compact;
}
