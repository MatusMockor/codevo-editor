import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { workbenchAgentThreadOpener } from "../application/agentThreadOpener";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AppUpdaterSurface } from "../application/useAppUpdater";
import type { SystemFontGateway } from "../domain/systemFonts";
import { settingsEnvironment } from "./settings/settingsEnvironment";
import type { SettingsSaveInput } from "./settings/settingsPageProps";
import { WorkbenchSettingsScreen } from "./settings/WorkbenchSettingsScreen";
import type { WorkbenchSettingsModel } from "./settings/workbenchSettingsModel";

export type { WorkbenchSettingsModel } from "./settings/workbenchSettingsModel";

export interface WorkbenchSettingsHostProps {
  readonly appUpdater: AppUpdaterSurface;
  readonly container: HTMLElement | null;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  readonly systemFontGateway: SystemFontGateway;
  readonly workbench: WorkbenchSettingsModel;
}

export function WorkbenchSettingsHost({
  appUpdater,
  container,
  providerManagement = null,
  systemFontGateway,
  workbench,
}: WorkbenchSettingsHostProps) {
  const env = useMemo(
    () =>
      settingsEnvironment({
        agentThreadOpener: workbenchAgentThreadOpener,
        appUpdater,
        providerManagement,
        systemFontGateway,
        workbench,
      }),
    [appUpdater, providerManagement, systemFontGateway, workbench],
  );
  const { saveWorkbenchSettings, setSettingsOpen } = workbench;
  const save = useCallback(
    (input: SettingsSaveInput) =>
      saveWorkbenchSettings(input.appSettings, input.workspaceSettings, input.trusted),
    [saveWorkbenchSettings],
  );
  const close = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);

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
}
