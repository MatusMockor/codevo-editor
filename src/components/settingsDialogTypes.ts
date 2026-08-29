import type { AppUpdaterSurface } from "../application/useAppUpdater";
import type { AppSettings, SettingsSection, WorkspaceSettings } from "../domain/settings";
import type { SystemFontGateway } from "../domain/systemFonts";
import type { WorkspaceTrustState } from "../domain/trust";
import type { PhpToolAvailability, WorkspaceDescriptor } from "../domain/workspace";
import type { AgentSettingsDialogProviderControls } from "./AgentSettingsDialogSection";

export interface SettingsSaveInput {
  appSettings: AppSettings;
  trusted: boolean | null;
  workspaceSettings: WorkspaceSettings;
}

export interface SettingsDialogProps extends AgentSettingsDialogProviderControls {
  appUpdater?: AppUpdaterSurface | null;
  appSettings: AppSettings;
  gitDetectedRepositoryMappings?: string[];
  initialSection?: SettingsSection;
  isOpen: boolean;
  phpTools: PhpToolAvailability | null;
  systemFontGateway?: SystemFontGateway;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
  workspaceSettings: WorkspaceSettings;
  workspaceTrust: WorkspaceTrustState | null;
  onClose(): void;
  onOpenJavaScriptTypeScriptServiceLog(): Promise<void>;
  onOpenNodeLaunchConfigurations?(): void;
  onRestartJavaScriptTypeScriptService(): Promise<void>;
  onSave(input: SettingsSaveInput): Promise<void>;
}
