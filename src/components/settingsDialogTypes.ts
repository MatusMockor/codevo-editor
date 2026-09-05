import type { AppSettings, WorkspaceSettings } from "../domain/settings";

export interface SettingsSaveInput {
  appSettings: AppSettings;
  trusted: boolean | null;
  workspaceSettings: WorkspaceSettings;
}
