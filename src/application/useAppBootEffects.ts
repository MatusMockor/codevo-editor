import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { preloadSyntaxHighlighter } from "./preloadSyntaxHighlighter";

export function useAppSyntaxHighlighterPreload(
  createHighlighter: Parameters<typeof preloadSyntaxHighlighter>[0],
): void {
  useEffect(() => {
    preloadSyntaxHighlighter(createHighlighter);
  }, [createHighlighter]);
}

export function useAppWindowTitle(windowTitle: string): void {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    void getCurrentWindow()
      .setTitle(windowTitle)
      .catch(() => {});
  }, [windowTitle]);
}
