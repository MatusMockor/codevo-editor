import { useEffect, useState } from "react";
import type { EditorChromeActivity } from "./EditorChromeContext";

export const EDITOR_BUSY_REVEAL_DELAY_MS = 450;

export function useRevealedEditorActivity(
  activity: EditorChromeActivity | null,
): EditorChromeActivity | null {
  const busy = activity?.kind === "busy";
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setRevealed(true), EDITOR_BUSY_REVEAL_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setRevealed(false);
    };
  }, [busy]);
  if (activity === null || activity.kind === "problem") return activity;
  return revealed ? activity : null;
}
