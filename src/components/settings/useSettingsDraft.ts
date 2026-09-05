import { useEffect, useMemo, useRef, useState } from "react";
import {
  settingsIgnorePatternsText,
  type AppSettings,
  type WorkspaceSettings,
} from "../../domain/settings";
import { settingsDraftPersistence } from "./settingsDraftPersistence";
import type { SettingsDraft, SettingsDraftActions, SettingsSaveInput } from "./settingsPageProps";

export interface SettingsDraftOptions {
  readonly appSettings: AppSettings;
  readonly hasWorkspace: boolean;
  readonly trusted: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  onSave(input: SettingsSaveInput): Promise<void>;
}

export interface SettingsDraftController {
  readonly actions: SettingsDraftActions;
  readonly draft: SettingsDraft;
}

export function useSettingsDraft({
  appSettings,
  hasWorkspace,
  onSave,
  trusted,
  workspaceSettings,
}: SettingsDraftOptions): SettingsDraftController {
  const [draftAppSettings, setDraftAppSettings] = useState(appSettings);
  const [draftWorkspaceSettings, setDraftWorkspaceSettings] = useState(workspaceSettings);
  const [draftTrusted, setDraftTrusted] = useState(trusted);
  const [ignorePatternsText, setIgnorePatternsText] = useState(() =>
    settingsIgnorePatternsText(workspaceSettings.extraIgnorePatterns),
  );
  const appSettingsRef = useRef(draftAppSettings);
  const workspaceSettingsRef = useRef(draftWorkspaceSettings);
  const trustedRef = useRef(draftTrusted);
  const saveRef = useRef(onSave);

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  const actions = useMemo<SettingsDraftActions>(
    () => ({
      ...settingsDraftPersistence({
        appSettingsRef,
        hasWorkspace,
        onSave: (input) => saveRef.current(input),
        setAppSettings: setDraftAppSettings,
        setTrusted: setDraftTrusted,
        setWorkspaceSettings: setDraftWorkspaceSettings,
        trustedRef,
        workspaceSettingsRef,
      }),
      updateIgnorePatternsText: setIgnorePatternsText,
    }),
    [hasWorkspace],
  );

  const draft = useMemo<SettingsDraft>(
    () => ({
      appSettings: draftAppSettings,
      ignorePatternsText,
      trusted: draftTrusted,
      workspaceSettings: draftWorkspaceSettings,
    }),
    [draftAppSettings, draftTrusted, draftWorkspaceSettings, ignorePatternsText],
  );

  return { actions, draft };
}
