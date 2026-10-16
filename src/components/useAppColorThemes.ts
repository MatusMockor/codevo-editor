import { useMemo } from "react";
import type { NativeWindowPort } from "../application/nativeWindowPort";
import type { AppearanceSettings, ResolvedColorScheme } from "../domain/appearance";
import {
  resolveAppColorThemes,
  type CodeTheme,
  type TerminalTheme,
} from "../domain/appColorThemes";
import { useDocumentAppearance } from "./useDocumentAppearance";
import { useNativeWindowBackground } from "./useNativeWindowBackground";

export interface AppThemes {
  readonly colorScheme: ResolvedColorScheme;
  readonly codeTheme: CodeTheme;
  readonly terminalTheme: TerminalTheme;
}

export function useAppColorThemes(
  appearance: AppearanceSettings,
  prefersLightTheme: boolean,
  nativeWindow: NativeWindowPort | null = null,
): AppThemes {
  const themes = useMemo(
    () => resolveAppColorThemes(appearance, prefersLightTheme),
    [appearance, prefersLightTheme],
  );
  useDocumentAppearance(appearance.palette, themes.colorScheme);
  useNativeWindowBackground(nativeWindow, appearance.palette, themes.colorScheme);
  return themes;
}
