import { useEffect } from "react";
import type { AppTheme } from "../domain/settings";
import { STARTUP_THEME_ATTRIBUTE, startupThemeFor } from "../domain/startupTheme";

export function useDocumentStartupTheme(theme: AppTheme, prefersLightTheme: boolean): void {
  useEffect(() => {
    document.documentElement.setAttribute(
      STARTUP_THEME_ATTRIBUTE,
      startupThemeFor(theme, prefersLightTheme),
    );
  }, [prefersLightTheme, theme]);
}
