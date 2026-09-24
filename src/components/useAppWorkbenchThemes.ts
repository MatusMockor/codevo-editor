import { useMemo } from "react";
import type { NativeWindowPort } from "../application/nativeWindowPort";
import type { AppearanceSettings, ResolvedColorScheme } from "../domain/appearance";
import {
  resolveEditorColorThemes,
  type MonacoAppTheme,
  type TerminalTheme,
} from "../domain/editorColorThemes";
import { useDocumentAppearance } from "./useDocumentAppearance";
import { useNativeWindowBackground } from "./useNativeWindowBackground";

export interface AppWorkbenchThemes {
  readonly colorScheme: ResolvedColorScheme;
  readonly monacoTheme: MonacoAppTheme;
  readonly terminalTheme: TerminalTheme;
}

export function useAppWorkbenchThemes(
  appearance: AppearanceSettings,
  prefersLightTheme: boolean,
  nativeWindow: NativeWindowPort | null = null,
): AppWorkbenchThemes {
  const themes = useMemo(
    () => resolveEditorColorThemes(appearance, prefersLightTheme),
    [appearance, prefersLightTheme],
  );
  useDocumentAppearance(appearance.palette, themes.colorScheme);
  useNativeWindowBackground(nativeWindow, appearance.palette, themes.colorScheme);
  return themes;
}
