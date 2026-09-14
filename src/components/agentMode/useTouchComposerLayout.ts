import { useEffect, useState } from "react";

export const TOUCH_COMPOSER_MAX_INLINE_SIZE = 600;
export const TOUCH_COMPOSER_QUERY = `(max-width: ${TOUCH_COMPOSER_MAX_INLINE_SIZE}px)`;

export function useTouchComposerLayout(): boolean {
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(TOUCH_COMPOSER_QUERY);
    const owner = { active: true };
    const update = (): void => {
      if (!owner.active) return;
      setTouch(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      owner.active = false;
      media.removeEventListener("change", update);
    };
  }, []);

  return touch;
}
