import type { PhpBackendPreference, WorkspaceSettings } from "../domain/settings";
import type { PhpToolAvailability, ToolLocation, WorkspaceDescriptor } from "../domain/workspace";

export interface PhpSettingsProps {
  hasWorkspace: boolean;
  phpTools: PhpToolAvailability | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceSettings: WorkspaceSettings;
  onChangePhpBackend(backend: PhpBackendPreference): void;
  onChangePhpInlayHints(enabled: boolean): void;
  onChangePhpstanAnalyseOnSave(enabled: boolean): void;
  onChangePhpVersionOverride(version: string): void;
  onChangeToolPath(key: "phpactorPath" | "intelephensePath" | "phpstanPath", value: string): void;
}

export function PhpSettings({
  hasWorkspace,
  onChangePhpBackend,
  onChangePhpInlayHints,
  onChangePhpstanAnalyseOnSave,
  onChangePhpVersionOverride,
  onChangeToolPath,
  phpTools,
  workspaceDescriptor,
  workspaceSettings,
}: PhpSettingsProps) {
  const detectedPhpVersion = detectedComposerPhpVersion(workspaceDescriptor);
  const effectivePhpVersion = workspaceSettings.phpVersionOverride || detectedPhpVersion || "Auto";

  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Backend</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangePhpBackend(event.currentTarget.value as PhpBackendPreference)
          }
          value={workspaceSettings.phpBackend}
        >
          <option value="auto">Auto</option>
          <option value="phpactor">Managed PHP engine</option>
          <option value="intelephense">Intelephense</option>
        </select>
      </label>

      <label className="settings-field">
        <span>PHP language level override</span>
        <input
          disabled={!hasWorkspace}
          onChange={(event) => onChangePhpVersionOverride(event.currentTarget.value)}
          placeholder={detectedPhpVersion || "Composer / Auto"}
          value={workspaceSettings.phpVersionOverride || ""}
        />
      </label>

      <label className="settings-field">
        <span>PHP engine path</span>
        <input
          disabled={!hasWorkspace}
          onChange={(event) => onChangeToolPath("phpactorPath", event.currentTarget.value)}
          placeholder={detectedToolPath(phpTools?.phpactor)}
          value={workspaceSettings.phpactorPath || ""}
        />
      </label>

      <label className="settings-field">
        <span>Intelephense path</span>
        <input
          disabled={!hasWorkspace}
          onChange={(event) => onChangeToolPath("intelephensePath", event.currentTarget.value)}
          placeholder={detectedToolPath(phpTools?.intelephense)}
          value={workspaceSettings.intelephensePath || ""}
        />
      </label>

      <label className="settings-field">
        <span>PHPStan path</span>
        <input
          disabled={!hasWorkspace}
          onChange={(event) => onChangeToolPath("phpstanPath", event.currentTarget.value)}
          placeholder="vendor/bin/phpstan / Auto"
          value={workspaceSettings.phpstanPath || ""}
        />
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.phpstanAnalyseOnSave}
          disabled={!hasWorkspace}
          onChange={(event) => onChangePhpstanAnalyseOnSave(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>PHPStan analyse on save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.phpInlayHints}
          disabled={!hasWorkspace}
          onChange={(event) => onChangePhpInlayHints(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>PHP inlay hints</span>
      </label>

      <div className="settings-readout">
        <span>Composer PHP</span>
        <code>{detectedPhpVersion || "Not declared"}</code>
      </div>
      <div className="settings-readout">
        <span>Effective PHP level</span>
        <code>{effectivePhpVersion}</code>
      </div>
      <div className="settings-readout">
        <span>Detected PHP engine</span>
        <code>{detectedToolPath(phpTools?.phpactor)}</code>
      </div>
      <div className="settings-readout">
        <span>Detected Intelephense</span>
        <code>{detectedToolPath(phpTools?.intelephense)}</code>
      </div>
    </div>
  );
}

function detectedComposerPhpVersion(
  workspaceDescriptor: WorkspaceDescriptor | null,
): string | null {
  const php = workspaceDescriptor?.php;

  if (!php) {
    return null;
  }

  return php.phpPlatformVersion || php.phpVersionConstraint || null;
}

function detectedToolPath(tool: ToolLocation | null | undefined): string {
  if (!tool) {
    return "Not detected";
  }

  return tool.path;
}
