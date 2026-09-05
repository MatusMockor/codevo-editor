import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AppSettings, WorkspaceSettings } from "../../domain/settings";
import type { SettingsSaveInput } from "./settingsPageProps";

export interface SettingsDraftPersistenceOptions {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly hasWorkspace: boolean;
  readonly onSave: (input: SettingsSaveInput) => Promise<void>;
  readonly setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  readonly setTrusted: Dispatch<SetStateAction<boolean>>;
  readonly setWorkspaceSettings: Dispatch<SetStateAction<WorkspaceSettings>>;
  readonly trustedRef: MutableRefObject<boolean>;
  readonly workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
}

export function settingsDraftPersistence(options: SettingsDraftPersistenceOptions) {
  const save = (input: Partial<SettingsSaveInput>): void => {
    void options
      .onSave({
        appSettings: input.appSettings ?? options.appSettingsRef.current,
        trusted: options.hasWorkspace ? (input.trusted ?? options.trustedRef.current) : null,
        workspaceSettings: input.workspaceSettings ?? options.workspaceSettingsRef.current,
      })
      .catch(() => undefined);
  };
  return {
    publishAppSettings: (settings: AppSettings): void => {
      options.appSettingsRef.current = settings;
      options.setAppSettings(settings);
    },
    save,
    updateAppSettings: (settings: AppSettings): void => {
      options.appSettingsRef.current = settings;
      options.setAppSettings(settings);
      save({ appSettings: settings });
    },
    updateTrusted: (trusted: boolean): void => {
      options.trustedRef.current = trusted;
      options.setTrusted(trusted);
      save({ trusted });
    },
    updateWorkspaceSettings: (settings: WorkspaceSettings): void => {
      options.workspaceSettingsRef.current = settings;
      options.setWorkspaceSettings(settings);
      save({ workspaceSettings: settings });
    },
  };
}
