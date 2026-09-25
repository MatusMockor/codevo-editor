import type { AppUpdateChannel } from "../../domain/appUpdateChannel";
import type { AppUpdaterGateway, AppUpdaterPreferencesGateway } from "../../domain/appUpdater";
import { useAppUpdater, type AppUpdaterSurface } from "../useAppUpdater";

export interface WorkbenchAppUpdaterComposition {
  readonly appUpdaterGateway: AppUpdaterGateway;
  readonly appUpdaterPreferencesGateway: AppUpdaterPreferencesGateway;
  readonly appVersion: string;
}

export function useWorkbenchAppUpdaterComposition(
  composition: WorkbenchAppUpdaterComposition,
  persistSkippedVersion: (version: string) => Promise<void>,
  channel: AppUpdateChannel,
  settingsHydrated: boolean,
): AppUpdaterSurface {
  return useAppUpdater({
    channel,
    currentVersion: composition.appVersion,
    gateway: composition.appUpdaterGateway,
    preferencesGateway: composition.appUpdaterPreferencesGateway,
    persistSkippedVersion,
    settingsHydrated,
  });
}
