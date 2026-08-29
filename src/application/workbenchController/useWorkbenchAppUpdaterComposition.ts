import type { AppUpdaterGateway } from "../../domain/appUpdater";
import { useAppUpdater, type AppUpdaterSurface } from "../useAppUpdater";

export interface WorkbenchAppUpdaterComposition {
  readonly appUpdaterGateway: AppUpdaterGateway;
  readonly appVersion: string;
}

export function useWorkbenchAppUpdaterComposition(
  composition: WorkbenchAppUpdaterComposition,
): AppUpdaterSurface {
  return useAppUpdater({
    currentVersion: composition.appVersion,
    gateway: composition.appUpdaterGateway,
  });
}
