import { useEffect, type RefObject } from "react";
import type { AppSettings, SettingsGateway } from "../../domain/settings";
import type { WorkspaceStartupRestoreIntent } from "./useWorkspaceOpenRequestLifecycle";

export interface InitialAppSettingsHydrationOptions {
  readonly hasRestoredRef: RefObject<boolean>;
  readonly settingsGateway: Pick<SettingsGateway, "loadAppSettings">;
  applyAppSettings(settings: AppSettings): void;
  beginStartupRestore(): WorkspaceStartupRestoreIntent;
  reportError(scope: string, error: unknown): void;
}

export function useInitialAppSettingsHydration({
  applyAppSettings,
  beginStartupRestore,
  hasRestoredRef,
  reportError,
  settingsGateway,
}: InitialAppSettingsHydrationOptions): void {
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    let active = true;
    const startupRestore = beginStartupRestore();

    void (async () => {
      let settings: AppSettings;
      try {
        settings = await settingsGateway.loadAppSettings();
      } catch (error) {
        if (!active) return;
        reportError("Settings", error);
        return;
      }
      if (!active) return;
      try {
        applyAppSettings(settings);
      } catch (error) {
        if (!active) return;
        reportError("Settings", error);
        return;
      }
      const workspacePath = settings.recentWorkspacePath ?? settings.workspaceTabs[0] ?? null;
      if (workspacePath === null) return;
      if (!active || !startupRestore.isCurrent()) return;
      try {
        await startupRestore.openWorkspacePath(workspacePath);
        if (!active || !startupRestore.isCurrent()) return;
      } catch (error) {
        if (!active || !startupRestore.isCurrent()) return;
        reportError("Settings", error);
      }
    })();

    return () => {
      active = false;
    };
  }, [applyAppSettings, beginStartupRestore, hasRestoredRef, reportError, settingsGateway]);
}
