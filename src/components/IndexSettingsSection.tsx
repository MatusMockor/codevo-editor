import {
  MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MAX_LARGE_SMART_DOCUMENT_LINE_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
} from "../domain/largeDocumentPolicy";
import type { WorkspaceSettings } from "../domain/settings";
import { boundedPositiveIntegerInputValue } from "./settingsDialogModel";

export interface IndexSettingsProps {
  hasWorkspace: boolean;
  ignorePatternsText: string;
  largeFileMode: WorkspaceSettings["largeFileMode"];
  onChangeIgnorePatternsText(value: string): void;
  onChangeLargeFileModeCharacterLimit(characterLimit: number): void;
  onChangeLargeFileModeLineLimit(lineLimit: number): void;
}

export function IndexSettings({
  hasWorkspace,
  ignorePatternsText,
  largeFileMode,
  onChangeIgnorePatternsText,
  onChangeLargeFileModeCharacterLimit,
  onChangeLargeFileModeLineLimit,
}: IndexSettingsProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Large file character limit</span>
        <input
          disabled={!hasWorkspace}
          max={MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT}
          min={MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT}
          onChange={(event) => {
            const value = boundedPositiveIntegerInputValue(
              event.currentTarget.value,
              MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
              MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
            );

            if (value === null) {
              return;
            }

            onChangeLargeFileModeCharacterLimit(value);
          }}
          step={1024}
          type="number"
          value={largeFileMode.characterLimit}
        />
      </label>

      <label className="settings-field">
        <span>Large file line limit</span>
        <input
          disabled={!hasWorkspace}
          max={MAX_LARGE_SMART_DOCUMENT_LINE_LIMIT}
          min={MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT}
          onChange={(event) => {
            const value = boundedPositiveIntegerInputValue(
              event.currentTarget.value,
              MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
              MAX_LARGE_SMART_DOCUMENT_LINE_LIMIT,
            );

            if (value === null) {
              return;
            }

            onChangeLargeFileModeLineLimit(value);
          }}
          step={100}
          type="number"
          value={largeFileMode.lineLimit}
        />
      </label>

      <label className="settings-field">
        <span>Extra ignores</span>
        <textarea
          disabled={!hasWorkspace}
          onChange={(event) => onChangeIgnorePatternsText(event.currentTarget.value)}
          rows={8}
          spellCheck={false}
          value={ignorePatternsText}
        />
      </label>

      <div className="settings-readout">
        <span>Built-in ignores</span>
        <code>.git, node_modules, vendor, target, dist, build</code>
      </div>
    </div>
  );
}
