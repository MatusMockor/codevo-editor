import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AppUpdaterSurface } from "../application/useAppUpdater";
import type { SystemFontGateway } from "../domain/systemFonts";
import { NodeLaunchConfigurationsDialog } from "./NodeLaunchConfigurationsDialog";
import { settingsEnvironment } from "./settings/settingsEnvironment";
import type { SettingsSaveInput } from "./settings/settingsPageProps";
import { WorkbenchSettingsScreen } from "./settings/WorkbenchSettingsScreen";
import type { WorkbenchSettingsModel } from "./settings/workbenchSettingsModel";
import {
  useNodeLaunchConfigurationsDialogController,
  type NodeLaunchConfigurationFileGateway,
} from "./useNodeLaunchConfigurationsDialogController";

export type { WorkbenchSettingsModel } from "./settings/workbenchSettingsModel";

export interface WorkbenchSettingsHostProps {
  readonly appUpdater: AppUpdaterSurface;
  readonly container: HTMLElement | null;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  readonly systemFontGateway: SystemFontGateway;
  readonly workbench: WorkbenchSettingsModel;
  readonly workspaceFiles: NodeLaunchConfigurationFileGateway;
}

export function WorkbenchSettingsHost({
  appUpdater,
  container,
  providerManagement = null,
  systemFontGateway,
  workbench,
  workspaceFiles,
}: WorkbenchSettingsHostProps) {
  const nodeLaunchDialog = useNodeLaunchConfigurationsDialogController({
    isOpen: workbench.nodeLaunchConfigurationsOpen,
    onClose: workbench.closeNodeLaunchConfigurations,
    rootPath: workbench.workspaceRoot,
    workspaceFiles,
    workspaceId: workbench.workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceTrusted: workbench.workspaceTrust?.trusted === true,
  });
  const env = useMemo(
    () => settingsEnvironment({ appUpdater, providerManagement, systemFontGateway, workbench }),
    [appUpdater, providerManagement, systemFontGateway, workbench],
  );
  const { saveWorkbenchSettings, setSettingsOpen } = workbench;
  const save = useCallback(
    (input: SettingsSaveInput) =>
      saveWorkbenchSettings(input.appSettings, input.workspaceSettings, input.trusted),
    [saveWorkbenchSettings],
  );
  const close = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);

  const renderScreen = () => {
    if (container === null) return null;
    if (!workbench.settingsOpen) return null;

    return createPortal(
      <WorkbenchSettingsScreen
        env={env}
        initialAppSettings={workbench.appSettings}
        initialSection={workbench.settingsInitialSection}
        initialTrusted={workbench.workspaceTrust?.trusted === true}
        initialWorkspaceSettings={workbench.workspaceSettings}
        key={workbench.workspaceIdentityDescriptor?.workspaceId ?? "no-workspace"}
        onClose={close}
        onSave={save}
      />,
      container,
    );
  };

  return (
    <>
      {renderScreen()}
      <NodeLaunchConfigurationsDialog {...nodeLaunchDialog} />
    </>
  );
}
