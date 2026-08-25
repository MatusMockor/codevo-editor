import { useEffect, useState } from "react";

export const COMPACT_COMPOSER_QUERY = "(max-width: 620px)";

export function useCompactComposerControls(): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(COMPACT_COMPOSER_QUERY);
    const update = (): void => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return compact;
}
