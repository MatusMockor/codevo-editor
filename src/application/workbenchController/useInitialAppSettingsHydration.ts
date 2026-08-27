import { useEffect, type RefObject } from "react";
import type { AppSettings, SettingsGateway } from "../../domain/settings";

export interface InitialAppSettingsHydrationOptions {
  readonly hasRestoredRef: RefObject<boolean>;
  readonly settingsGateway: Pick<SettingsGateway, "loadAppSettings">;
  applyAppSettings(settings: AppSettings): void;
  openWorkspacePath(path: string): void | Promise<void>;
  reportError(scope: string, error: unknown): void;
}

export function useInitialAppSettingsHydration({
  applyAppSettings,
  hasRestoredRef,
  openWorkspacePath,
  reportError,
  settingsGateway,
}: InitialAppSettingsHydrationOptions): void {
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    let active = true;
    let settingsLoad: Promise<AppSettings>;

    try {
      settingsLoad = settingsGateway.loadAppSettings();
    } catch (error) {
      reportError("Settings", error);
      return () => {
        active = false;
      };
    }

    settingsLoad
      .then((settings) => {
        if (!active) return;
        applyAppSettings(settings);
        const workspacePath = settings.recentWorkspacePath ?? settings.workspaceTabs[0] ?? null;
        if (workspacePath === null) return;
        if (!active) return;
        void openWorkspacePath(workspacePath);
      })
      .catch((error: unknown) => {
        if (!active) return;
        reportError("Settings", error);
      });

    return () => {
      active = false;
    };
  }, [applyAppSettings, hasRestoredRef, openWorkspacePath, reportError, settingsGateway]);
}
