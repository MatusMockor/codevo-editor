import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AppUpdaterSurface } from "../../application/useAppUpdater";
import type { SystemFontGateway } from "../../domain/systemFonts";
import { writeClipboardText } from "../clipboardText";
import type { SettingsEnvironment } from "./settingsPageProps";
import type { WorkbenchSettingsModel } from "./workbenchSettingsModel";

export interface SettingsEnvironmentInput {
  readonly appUpdater: AppUpdaterSurface | null;
  readonly providerManagement: AgentProviderManagementSurface | null;
  readonly systemFontGateway: SystemFontGateway;
  readonly workbench: WorkbenchSettingsModel;
}

export function settingsEnvironment({
  appUpdater,
  providerManagement,
  systemFontGateway,
  workbench,
}: SettingsEnvironmentInput): SettingsEnvironment {
  return {
    appUpdater,
    gitDetectedRepositoryMappings: workbench.gitRepositoryMappings
      .map((mapping) => mapping.rootRelativePath)
      .filter((path) => path !== ""),
    hasWorkspace: Boolean(workbench.workspaceRoot),
    onCopyInstallCommand: writeClipboardText,
    onOpenJavaScriptTypeScriptServiceLog: workbench.openJavaScriptTypeScriptServiceLog,
    onOpenNodeLaunchConfigurations: workbench.openNodeLaunchConfigurations,
    onRestartJavaScriptTypeScriptService: workbench.restartJavaScriptTypeScriptService,
    phpTools: workbench.phpTools,
    providerManagement,
    providerSignIn: workbench.agents?.providerSignIn ?? null,
    systemFontGateway,
    workspaceDescriptor: workbench.workspaceDescriptor,
    workspaceRoot: workbench.workspaceRoot,
  };
}
