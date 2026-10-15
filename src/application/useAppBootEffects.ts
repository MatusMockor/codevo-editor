import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

export function useAppWindowTitle(windowTitle: string): void {
  useEffect(() => {
    document.title = windowTitle;

    if (!isTauri()) {
      return;
    }

    void getCurrentWindow()
      .setTitle(windowTitle)
      .catch(() => {});
  }, [windowTitle]);
}
