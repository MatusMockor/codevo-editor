import { useMemo } from "react";
import type { AppearanceSettings, ResolvedColorScheme } from "../domain/appearance";
import {
  resolveEditorColorThemes,
  type MonacoAppTheme,
  type TerminalTheme,
} from "../domain/editorColorThemes";
import { useDocumentAppearance } from "./useDocumentAppearance";

export interface AppWorkbenchThemes {
  readonly colorScheme: ResolvedColorScheme;
  readonly monacoTheme: MonacoAppTheme;
  readonly terminalTheme: TerminalTheme;
}

export function useAppWorkbenchThemes(
  appearance: AppearanceSettings,
  prefersLightTheme: boolean,
): AppWorkbenchThemes {
  const themes = useMemo(
    () => resolveEditorColorThemes(appearance, prefersLightTheme),
    [appearance, prefersLightTheme],
  );
  useDocumentAppearance(appearance.palette, themes.colorScheme);
  return themes;
}
