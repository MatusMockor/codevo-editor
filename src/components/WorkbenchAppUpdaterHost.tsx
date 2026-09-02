import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import {
  useWorkbenchAppUpdaterComposition,
  type WorkbenchAppUpdaterComposition,
} from "../application/workbenchController/useWorkbenchAppUpdaterComposition";
import type { SystemFontGateway } from "../domain/systemFonts";
import { AppUpdateDialog } from "./AppUpdateDialog";
import { LazySurfaceHost, LazyWorkbenchSettingsDialogHost } from "./appLazySurfaces";
import type { WorkbenchSettingsModel } from "./WorkbenchSettingsDialogHost";
import type { NodeLaunchConfigurationFileGateway } from "./useNodeLaunchConfigurationsDialogController";

export interface WorkbenchAppUpdaterHostProps {
  readonly composition: WorkbenchAppUpdaterComposition;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly systemFontGateway: SystemFontGateway;
  readonly workbench: WorkbenchSettingsModel & {
    readonly persistAppUpdaterSkippedVersion: (version: string) => Promise<void>;
  };
  readonly workspaceFiles: NodeLaunchConfigurationFileGateway;
}

export function WorkbenchAppUpdaterHost({
  composition,
  providerManagement,
  systemFontGateway,
  workbench,
  workspaceFiles,
}: WorkbenchAppUpdaterHostProps) {
  const updater = useWorkbenchAppUpdaterComposition(
    composition,
    workbench.persistAppUpdaterSkippedVersion,
  );
  return (
    <>
      <AppUpdateDialog updater={updater} />
      <LazySurfaceHost
        active={workbench.settingsOpen || workbench.nodeLaunchConfigurationsOpen}
        label="settings"
      >
        <LazyWorkbenchSettingsDialogHost
          appUpdater={updater}
          providerManagement={providerManagement}
          systemFontGateway={systemFontGateway}
          workbench={workbench}
          workspaceFiles={workspaceFiles}
        />
      </LazySurfaceHost>
    </>
  );
}
