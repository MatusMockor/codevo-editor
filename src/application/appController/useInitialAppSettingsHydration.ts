import { useEffect, useRef, type RefObject } from "react";
import { defaultAppSettings, type AppSettings, type SettingsGateway } from "../../domain/settings";
import {
  isEligibleWorkspaceRoot,
  UNKNOWN_WORKSPACE_HOME,
  type WorkspaceHomeReference,
} from "../../domain/workspaceRootEligibility";
import type { WorkspaceStartupRestoreIntent } from "./useWorkspaceOpenRequestLifecycle";

export interface InitialAppSettingsHydrationOptions {
  readonly hasRestoredRef: RefObject<boolean>;
  readonly settingsGateway: Pick<SettingsGateway, "loadAppSettings">;
  applyAppSettings(settings: AppSettings): void;
  beginStartupRestore(): WorkspaceStartupRestoreIntent;
  onAppSettingsHydrated(hydrated: true): void;
  reportError(scope: string, error: unknown): void;
  resolveWorkspaceHome?(): Promise<WorkspaceHomeReference>;
}

export const WORKSPACE_HOME_RESOLUTION_TIMEOUT_MS = 2_000;

interface WorkspaceHomeResolution {
  readonly home: Promise<WorkspaceHomeReference>;
  cancel(): void;
}

export function useInitialAppSettingsHydration({
  applyAppSettings,
  beginStartupRestore,
  hasRestoredRef,
  onAppSettingsHydrated,
  reportError,
  resolveWorkspaceHome,
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

    const homeResolution = startWorkspaceHomeResolution(resolveWorkspaceHome);

    void (async () => {
      let loadedSettings: AppSettings;
      try {
        loadedSettings = await settingsGateway.loadAppSettings();
      } catch (error) {
        if (!isCurrent()) return;
        reportError("Settings", error);
        loadedSettings = defaultAppSettings();
      }
      if (!isCurrent()) return;
      const home = homeResolution === null ? UNKNOWN_WORKSPACE_HOME : await homeResolution.home;
      if (!isCurrent()) return;
      const settings = withoutIneligibleWorkspaceRoots(loadedSettings, home);
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
      homeResolution?.cancel();
      if (ownerGenerationRef.current !== ownerGeneration) return;
      ownerGenerationRef.current += 1;
    };
  }, [
    applyAppSettings,
    beginStartupRestore,
    hasRestoredRef,
    onAppSettingsHydrated,
    reportError,
    resolveWorkspaceHome,
    settingsGateway,
  ]);
}

function startWorkspaceHomeResolution(
  resolveWorkspaceHome: (() => Promise<WorkspaceHomeReference>) | undefined,
): WorkspaceHomeResolution | null {
  if (resolveWorkspaceHome === undefined) return null;
  let settleHome: (reference: WorkspaceHomeReference) => void = () => undefined;
  const home = new Promise<WorkspaceHomeReference>((settle) => {
    settleHome = settle;
  });
  let pending = true;
  const finish = (reference: WorkspaceHomeReference) => {
    if (!pending) return;
    pending = false;
    clearTimeout(timeout);
    settleHome(reference);
  };
  const timeout = setTimeout(
    () => finish(UNKNOWN_WORKSPACE_HOME),
    WORKSPACE_HOME_RESOLUTION_TIMEOUT_MS,
  );
  try {
    resolveWorkspaceHome().then(finish, () => finish(UNKNOWN_WORKSPACE_HOME));
  } catch {
    finish(UNKNOWN_WORKSPACE_HOME);
  }
  return { home, cancel: () => finish(UNKNOWN_WORKSPACE_HOME) };
}

function withoutIneligibleWorkspaceRoots(
  settings: AppSettings,
  home: WorkspaceHomeReference,
): AppSettings {
  const recentWorkspacePath = settings.recentWorkspacePath;
  const recentEligible =
    recentWorkspacePath === null || isEligibleWorkspaceRoot(recentWorkspacePath, home);
  const isEligible = (path: string) => isEligibleWorkspaceRoot(path, home);
  const workspaceTabs = settings.workspaceTabs.filter(isEligible);
  const recentWorkspacePaths = settings.recentWorkspacePaths?.filter(isEligible);
  const unchanged =
    recentEligible &&
    workspaceTabs.length === settings.workspaceTabs.length &&
    recentWorkspacePaths?.length === settings.recentWorkspacePaths?.length;
  if (unchanged) return settings;

  return {
    ...settings,
    recentWorkspacePath: recentEligible ? recentWorkspacePath : null,
    ...(recentWorkspacePaths === undefined ? {} : { recentWorkspacePaths }),
    workspaceTabs,
  };
}
