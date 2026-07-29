import { useCallback, useState } from "react";
import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";

export function useEditorChromeActions(runner: EditorMenuCommandRunner | null) {
  const [activeFileRevealSignal, setActiveFileRevealSignal] = useState(0);
  const markActiveFileRevealSignal = useCallback(() => {
    setActiveFileRevealSignal((current) => current + 1);
  }, []);
  const showGoToLine = useCallback(() => {
    runner?.("gotoLine");
  }, [runner]);

  return { activeFileRevealSignal, markActiveFileRevealSignal, showGoToLine };
}
