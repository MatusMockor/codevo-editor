import type { AppUpdaterGateway, AppUpdaterPreferencesGateway } from "../../domain/appUpdater";
import { useAppUpdater, type AppUpdaterSurface } from "../useAppUpdater";

export interface WorkbenchAppUpdaterComposition {
  readonly appUpdaterGateway: AppUpdaterGateway;
  readonly appUpdaterPreferencesGateway: AppUpdaterPreferencesGateway;
  readonly appVersion: string;
}

export interface WorkbenchAppUpdaterOwner {
  readonly persistAppUpdaterSkippedVersion: (version: string) => Promise<void>;
}

export function useWorkbenchAppUpdaterComposition(
  composition: WorkbenchAppUpdaterComposition,
  owner: WorkbenchAppUpdaterOwner,
): AppUpdaterSurface {
  return useAppUpdater({
    currentVersion: composition.appVersion,
    gateway: composition.appUpdaterGateway,
    preferencesGateway: composition.appUpdaterPreferencesGateway,
    persistSkippedVersion: owner.persistAppUpdaterSkippedVersion,
  });
}
