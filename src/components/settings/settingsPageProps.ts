import type { AppUpdaterSurface } from "../../application/useAppUpdater";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentProviderSignInSurface } from "../../application/useAgentProviderSignIn";
import type { AppSettings, WorkspaceSettings } from "../../domain/settings";
import type { SystemFontGateway } from "../../domain/systemFonts";
import type { PhpToolAvailability, WorkspaceDescriptor } from "../../domain/workspace";
import type { SettingsSaveInput } from "../settingsDialogTypes";

export type { SettingsSaveInput } from "../settingsDialogTypes";

export interface SettingsDraft {
  readonly appSettings: AppSettings;
  readonly ignorePatternsText: string;
  readonly trusted: boolean;
  readonly workspaceSettings: WorkspaceSettings;
}

export interface SettingsDraftActions {
  publishAppSettings(settings: AppSettings): void;
  save(input: Partial<SettingsSaveInput>): void;
  updateAppSettings(settings: AppSettings): void;
  updateIgnorePatternsText(value: string): void;
  updateTrusted(trusted: boolean): void;
  updateWorkspaceSettings(settings: WorkspaceSettings): void;
}

export interface SettingsEnvironment {
  readonly appUpdater: AppUpdaterSurface | null;
  readonly gitDetectedRepositoryMappings: ReadonlyArray<string>;
  readonly hasWorkspace: boolean;
  readonly phpTools: PhpToolAvailability | null;
  readonly providerManagement: AgentProviderManagementSurface | null;
  readonly providerSignIn: AgentProviderSignInSurface | null;
  readonly systemFontGateway: SystemFontGateway;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
  readonly workspaceRoot: string | null;
  onCopyInstallCommand(command: string): void;
  onOpenJavaScriptTypeScriptServiceLog(): Promise<void>;
  onOpenNodeLaunchConfigurations(): void;
  onRestartJavaScriptTypeScriptService(): Promise<void>;
}

export interface SettingsPageProps {
  readonly actions: SettingsDraftActions;
  readonly draft: SettingsDraft;
  readonly env: SettingsEnvironment;
}
