import { useState } from "react";
import {
  gitDirectoryMappingPaths,
  normalizeGitDirectoryMappings,
} from "../../../domain/gitRepositoryMapping";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import { SettingsTextField } from "../primitives/SettingsTextField";
import type { SettingsPageProps } from "../settingsPageProps";

export function GitDirectoryMappingsRows({ actions, draft, env }: SettingsPageProps) {
  const [draftPath, setDraftPath] = useState("");
  const settings = draft.workspaceSettings;
  const disabled = !env.hasWorkspace;
  const mappings = settings.gitDirectoryMappings;
  const manualKeys = new Set(mappings.map((path) => path.toLowerCase()));
  const detected = env.gitDetectedRepositoryMappings.filter(
    (path) => path !== "" && !manualKeys.has(path.toLowerCase()),
  );

  const publish = (gitDirectoryMappings: string[]): void =>
    actions.updateWorkspaceSettings({ ...settings, gitDirectoryMappings });

  const addMapping = (): void => {
    publish(
      gitDirectoryMappingPaths(normalizeGitDirectoryMappings([...mappings, draftPath])).filter(
        (path) => path !== "",
      ),
    );
    setDraftPath("");
  };

  return (
    <SettingsSectionHeading title="Git directory mappings">
      <SettingsRow rowId="index.gitDirectoryMappingsAuto">
        <SettingsSwitch
          checked={settings.gitDirectoryMappingsAuto}
          disabled={disabled}
          onChange={(gitDirectoryMappingsAuto) =>
            actions.updateWorkspaceSettings({ ...settings, gitDirectoryMappingsAuto })
          }
        />
      </SettingsRow>

      <SettingsRow layout="stacked" rowId="index.gitDirectoryMappings">
        <div className="settings-mappings">
          {settings.gitDirectoryMappingsAuto && detected.length > 0 ? (
            <ul className="settings-mappings__list">
              {detected.map((path) => (
                <li className="settings-mappings__item" key={path}>
                  <code className="settings-mappings__path">{path}</code>
                  <span className="settings-mappings__badge">Auto-detected</span>
                </li>
              ))}
            </ul>
          ) : null}

          {mappings.length === 0 ? (
            <p className="settings-readout">No manual mappings</p>
          ) : (
            <ul className="settings-mappings__list">
              {mappings.map((path) => (
                <li className="settings-mappings__item" key={path}>
                  <code className="settings-mappings__path">{path}</code>
                  <SettingsButton
                    disabled={disabled}
                    onClick={() => publish(mappings.filter((mapping) => mapping !== path))}
                    size="compact"
                    title="Remove mapping"
                    variant="ghostMuted"
                  >
                    Remove
                  </SettingsButton>
                </li>
              ))}
            </ul>
          )}

          <div className="settings-mappings__add">
            <SettingsTextField
              disabled={disabled}
              label="Add repository directory"
              mono
              onChange={setDraftPath}
              placeholder="workbench/lcsk/attendance"
              value={draftPath}
              width="full"
            />
            <SettingsButton
              disabled={disabled || draftPath.trim() === ""}
              onClick={addMapping}
              size="compact"
              variant="outline"
            >
              Add
            </SettingsButton>
          </div>
        </div>
      </SettingsRow>
    </SettingsSectionHeading>
  );
}
