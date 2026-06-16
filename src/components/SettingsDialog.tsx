import { Save, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  settingsIgnorePatternsFromText,
  settingsIgnorePatternsText,
  type AppSettings,
  type AppTheme,
  type PhpBackendPreference,
  type WorkspaceSettings,
} from "../domain/settings";
import type { WorkspaceTrustState } from "../domain/trust";
import type {
  IntelligenceMode,
  PhpToolAvailability,
  ToolLocation,
} from "../domain/workspace";

export interface SettingsSaveInput {
  appSettings: AppSettings;
  trusted: boolean | null;
  workspaceSettings: WorkspaceSettings;
}

interface SettingsDialogProps {
  appSettings: AppSettings;
  isOpen: boolean;
  phpTools: PhpToolAvailability | null;
  workspaceRoot: string | null;
  workspaceSettings: WorkspaceSettings;
  workspaceTrust: WorkspaceTrustState | null;
  onClose(): void;
  onSave(input: SettingsSaveInput): Promise<void>;
}

type SettingsSection = "general" | "php" | "index" | "appearance";

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "general", label: "General" },
  { id: "php", label: "PHP" },
  { id: "index", label: "Index" },
  { id: "appearance", label: "Appearance" },
];

export function SettingsDialog({
  appSettings,
  isOpen,
  onClose,
  onSave,
  phpTools,
  workspaceRoot,
  workspaceSettings,
  workspaceTrust,
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");
  const [draftAppSettings, setDraftAppSettings] =
    useState<AppSettings>(appSettings);
  const [draftWorkspaceSettings, setDraftWorkspaceSettings] =
    useState<WorkspaceSettings>(workspaceSettings);
  const [draftTrusted, setDraftTrusted] = useState(false);
  const [ignorePatternsText, setIgnorePatternsText] = useState("");
  const [saving, setSaving] = useState(false);
  const hasWorkspace = Boolean(workspaceRoot);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveSection("general");
    setDraftAppSettings(appSettings);
    setDraftWorkspaceSettings(workspaceSettings);
    setDraftTrusted(Boolean(workspaceTrust?.trusted));
    setIgnorePatternsText(
      settingsIgnorePatternsText(workspaceSettings.extraIgnorePatterns),
    );
  }, [appSettings, isOpen, workspaceSettings, workspaceTrust]);

  const selectedSectionLabel = useMemo(() => {
    const section = sections.find((item) => item.id === activeSection);
    return section?.label || "Settings";
  }, [activeSection]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Settings"
        className="settings-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);

            try {
              await onSave({
                appSettings: draftAppSettings,
                trusted: hasWorkspace ? draftTrusted : null,
                workspaceSettings: {
                  ...draftWorkspaceSettings,
                  extraIgnorePatterns:
                    settingsIgnorePatternsFromText(ignorePatternsText),
                },
              });
            } finally {
              setSaving(false);
            }
          }}
        >
          <header className="settings-header">
            <span>
              <Settings2 aria-hidden="true" size={16} />
              Settings
            </span>
            <button onClick={onClose} title="Close" type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </header>

          <div className="settings-content">
            <nav aria-label="Settings sections" className="settings-nav">
              {sections.map((section) => (
                <button
                  aria-selected={activeSection === section.id}
                  className={
                    activeSection === section.id
                      ? "settings-nav-item active"
                      : "settings-nav-item"
                  }
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  type="button"
                >
                  {section.label}
                </button>
              ))}
            </nav>

            <div
              aria-label={selectedSectionLabel}
              className="settings-section"
              role="tabpanel"
            >
              {activeSection === "general" ? (
                <GeneralSettings
                  draftTrusted={draftTrusted}
                  hasWorkspace={hasWorkspace}
                  onChangeIntelligenceMode={(intelligenceMode) =>
                    setDraftWorkspaceSettings((current) => ({
                      ...current,
                      intelligenceMode,
                    }))
                  }
                  onChangeAutoSave={(autoSave) =>
                    setDraftWorkspaceSettings((current) => ({
                      ...current,
                      autoSave,
                    }))
                  }
                  onChangeTrusted={setDraftTrusted}
                  saving={saving}
                  workspaceRoot={workspaceRoot}
                  workspaceSettings={draftWorkspaceSettings}
                />
              ) : null}

              {activeSection === "php" ? (
                <PhpSettings
                  hasWorkspace={hasWorkspace}
                  onChangePhpBackend={(phpBackend) =>
                    setDraftWorkspaceSettings((current) => ({
                      ...current,
                      phpBackend,
                    }))
                  }
                  onChangeToolPath={(key, value) =>
                    setDraftWorkspaceSettings((current) => ({
                      ...current,
                      [key]: nullableInputValue(value),
                    }))
                  }
                  phpTools={phpTools}
                  saving={saving}
                  workspaceSettings={draftWorkspaceSettings}
                />
              ) : null}

              {activeSection === "index" ? (
                <IndexSettings
                  hasWorkspace={hasWorkspace}
                  ignorePatternsText={ignorePatternsText}
                  onChangeIgnorePatternsText={setIgnorePatternsText}
                  saving={saving}
                />
              ) : null}

              {activeSection === "appearance" ? (
                <AppearanceSettings
                  appSettings={draftAppSettings}
                  onChangeTheme={(theme) =>
                    setDraftAppSettings((current) => ({
                      ...current,
                      theme,
                    }))
                  }
                  saving={saving}
                />
              ) : null}
            </div>
          </div>

          <footer className="settings-footer">
            <button onClick={onClose} type="button">
              Cancel
            </button>
            <button className="settings-save" disabled={saving} type="submit">
              <Save aria-hidden="true" size={15} />
              Save
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

interface GeneralSettingsProps {
  draftTrusted: boolean;
  hasWorkspace: boolean;
  saving: boolean;
  workspaceRoot: string | null;
  workspaceSettings: WorkspaceSettings;
  onChangeAutoSave(autoSave: boolean): void;
  onChangeIntelligenceMode(mode: IntelligenceMode): void;
  onChangeTrusted(trusted: boolean): void;
}

function GeneralSettings({
  draftTrusted,
  hasWorkspace,
  onChangeAutoSave,
  onChangeIntelligenceMode,
  onChangeTrusted,
  saving,
  workspaceRoot,
  workspaceSettings,
}: GeneralSettingsProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Workspace</span>
        <input readOnly value={workspaceRoot || "No workspace open"} />
      </label>

      <label className="settings-field">
        <span>Mode</span>
        <select
          disabled={!hasWorkspace || saving}
          onChange={(event) =>
            onChangeIntelligenceMode(
              event.currentTarget.value as IntelligenceMode,
            )
          }
          value={workspaceSettings.intelligenceMode}
        >
          <option value="basic">Editor Mode</option>
          <option value="lightSmart">Smart Index</option>
          <option value="fullSmart">IDE Mode</option>
        </select>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.autoSave}
          disabled={!hasWorkspace || saving}
          onChange={(event) => onChangeAutoSave(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Auto Save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={draftTrusted}
          disabled={!hasWorkspace || saving}
          onChange={(event) => onChangeTrusted(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Trusted workspace</span>
      </label>
    </div>
  );
}

interface PhpSettingsProps {
  hasWorkspace: boolean;
  phpTools: PhpToolAvailability | null;
  saving: boolean;
  workspaceSettings: WorkspaceSettings;
  onChangePhpBackend(backend: PhpBackendPreference): void;
  onChangeToolPath(
    key: "phpactorPath" | "intelephensePath",
    value: string,
  ): void;
}

function PhpSettings({
  hasWorkspace,
  onChangePhpBackend,
  onChangeToolPath,
  phpTools,
  saving,
  workspaceSettings,
}: PhpSettingsProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Backend</span>
        <select
          disabled={!hasWorkspace || saving}
          onChange={(event) =>
            onChangePhpBackend(
              event.currentTarget.value as PhpBackendPreference,
            )
          }
          value={workspaceSettings.phpBackend}
        >
          <option value="auto">Auto</option>
          <option value="phpactor">PHPactor</option>
          <option value="intelephense">Intelephense</option>
        </select>
      </label>

      <label className="settings-field">
        <span>PHPactor path</span>
        <input
          disabled={!hasWorkspace || saving}
          onChange={(event) =>
            onChangeToolPath("phpactorPath", event.currentTarget.value)
          }
          placeholder={detectedToolPath(phpTools?.phpactor)}
          value={workspaceSettings.phpactorPath || ""}
        />
      </label>

      <label className="settings-field">
        <span>Intelephense path</span>
        <input
          disabled={!hasWorkspace || saving}
          onChange={(event) =>
            onChangeToolPath("intelephensePath", event.currentTarget.value)
          }
          placeholder={detectedToolPath(phpTools?.intelephense)}
          value={workspaceSettings.intelephensePath || ""}
        />
      </label>

      <div className="settings-readout">
        <span>Detected PHPactor</span>
        <code>{detectedToolPath(phpTools?.phpactor)}</code>
      </div>
      <div className="settings-readout">
        <span>Detected Intelephense</span>
        <code>{detectedToolPath(phpTools?.intelephense)}</code>
      </div>
    </div>
  );
}

interface IndexSettingsProps {
  hasWorkspace: boolean;
  ignorePatternsText: string;
  saving: boolean;
  onChangeIgnorePatternsText(value: string): void;
}

function IndexSettings({
  hasWorkspace,
  ignorePatternsText,
  onChangeIgnorePatternsText,
  saving,
}: IndexSettingsProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Extra ignores</span>
        <textarea
          disabled={!hasWorkspace || saving}
          onChange={(event) =>
            onChangeIgnorePatternsText(event.currentTarget.value)
          }
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

interface AppearanceSettingsProps {
  appSettings: AppSettings;
  saving: boolean;
  onChangeTheme(theme: AppTheme): void;
}

function AppearanceSettings({
  appSettings,
  onChangeTheme,
  saving,
}: AppearanceSettingsProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Theme</span>
        <select
          disabled={saving}
          onChange={(event) =>
            onChangeTheme(event.currentTarget.value as AppTheme)
          }
          value={appSettings.theme}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </label>
    </div>
  );
}

function detectedToolPath(tool: ToolLocation | null | undefined): string {
  if (!tool) {
    return "Not detected";
  }

  return tool.path;
}

function nullableInputValue(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed;
}
