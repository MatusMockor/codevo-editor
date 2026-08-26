import { useMemo } from "react";
import {
  monacoThemeForAppTheme,
  terminalThemeForAppTheme,
  type AppTheme,
  type MonacoAppTheme,
  type TerminalTheme,
} from "../domain/settings";

export interface AppWorkbenchThemes {
  readonly monacoTheme: MonacoAppTheme;
  readonly terminalTheme: TerminalTheme;
}

export function useAppWorkbenchThemes(
  theme: AppTheme,
  prefersLightTheme: boolean,
): AppWorkbenchThemes {
  return useMemo(
    () => ({
      monacoTheme: monacoThemeForAppTheme(theme, prefersLightTheme),
      terminalTheme: terminalThemeForAppTheme(theme, prefersLightTheme),
    }),
    [prefersLightTheme, theme],
  );
}
