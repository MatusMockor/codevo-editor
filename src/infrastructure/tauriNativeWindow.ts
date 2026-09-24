import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { NativeWindowPort } from "../application/nativeWindowPort";

export const STARTUP_WINDOW_REVEAL_COMMAND = "reveal_startup_window";

export function createTauriNativeWindow(): NativeWindowPort | null {
  if (!isTauri()) return null;
  return {
    async setBackgroundColor(color) {
      await Promise.all([
        getCurrentWindow().setBackgroundColor(color),
        getCurrentWebview().setBackgroundColor(color),
      ]);
    },
    async show() {
      await invoke(STARTUP_WINDOW_REVEAL_COMMAND);
    },
  };
}
