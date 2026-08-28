import { useEffect, useRef, type RefObject } from "react";
import { defaultAppSettings, type AppSettings, type SettingsGateway } from "../../domain/settings";
import type { WorkspaceStartupRestoreIntent } from "./useWorkspaceOpenRequestLifecycle";

export interface InitialAppSettingsHydrationOptions {
  readonly hasRestoredRef: RefObject<boolean>;
  readonly settingsGateway: Pick<SettingsGateway, "loadAppSettings">;
  applyAppSettings(settings: AppSettings): void;
  beginStartupRestore(): WorkspaceStartupRestoreIntent;
  onAppSettingsHydrated(hydrated: true): void;
  reportError(scope: string, error: unknown): void;
}

export function useInitialAppSettingsHydration({
  applyAppSettings,
  beginStartupRestore,
  hasRestoredRef,
  onAppSettingsHydrated,
  reportError,
  settingsGateway,
}: InitialAppSettingsHydrationOptions): void {
  const ownerGenerationRef = useRef(0);
  const hydrationSettledRef = useRef(false);

  useEffect(() => {
    if (hydrationSettledRef.current) return;
    if (hasRestoredRef.current && ownerGenerationRef.current === 0) return;
    const ownerGeneration = ownerGenerationRef.current + 1;
    ownerGenerationRef.current = ownerGeneration;
    hasRestoredRef.current = true;
    let active = true;
    const startupRestore = beginStartupRestore();
    const isCurrent = () => active && ownerGenerationRef.current === ownerGeneration;

    void (async () => {
      let settings: AppSettings;
      try {
        settings = await settingsGateway.loadAppSettings();
      } catch (error) {
        if (!isCurrent()) return;
        reportError("Settings", error);
        settings = defaultAppSettings();
      }
      if (!isCurrent()) return;
      try {
        applyAppSettings(settings);
      } catch (error) {
        if (!isCurrent()) return;
        reportError("Settings", error);
        return;
      }
      if (!isCurrent()) return;
      hydrationSettledRef.current = true;
      onAppSettingsHydrated(true);
      const workspacePath = settings.recentWorkspacePath ?? settings.workspaceTabs[0] ?? null;
      if (workspacePath === null) return;
      if (!isCurrent() || !startupRestore.isCurrent()) return;
      try {
        await startupRestore.openWorkspacePath(workspacePath);
        if (!isCurrent() || !startupRestore.isCurrent()) return;
      } catch (error) {
        if (!isCurrent() || !startupRestore.isCurrent()) return;
        reportError("Settings", error);
      }
    })();

    return () => {
      active = false;
      if (ownerGenerationRef.current !== ownerGeneration) return;
      ownerGenerationRef.current += 1;
    };
  }, [
    applyAppSettings,
    beginStartupRestore,
    hasRestoredRef,
    onAppSettingsHydrated,
    reportError,
    settingsGateway,
  ]);
}
