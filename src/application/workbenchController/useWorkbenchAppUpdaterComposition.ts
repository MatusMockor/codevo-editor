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
): AppUpdaterSurface {
  return useAppUpdater({
    currentVersion: composition.appVersion,
    gateway: composition.appUpdaterGateway,
    preferencesGateway: composition.appUpdaterPreferencesGateway,
    persistSkippedVersion,
  });
}
