import { Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  appThemeOptions,
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
  const draftAppSettingsRef = useRef(appSettings);
  const draftWorkspaceSettingsRef = useRef(workspaceSettings);
  const draftTrustedRef = useRef(false);
  const saveGenerationRef = useRef(0);
  const wasOpenRef = useRef(false);
  const hasWorkspace = Boolean(workspaceRoot);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;
    setActiveSection("general");
    setDraftAppSettings(appSettings);
    setDraftWorkspaceSettings(workspaceSettings);
    setDraftTrusted(Boolean(workspaceTrust?.trusted));
    draftAppSettingsRef.current = appSettings;
    draftWorkspaceSettingsRef.current = workspaceSettings;
    draftTrustedRef.current = Boolean(workspaceTrust?.trusted);
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

  const saveDraft = (input: Partial<SettingsSaveInput>) => {
    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;
    setSaving(true);

    void onSave({
      appSettings: input.appSettings ?? draftAppSettingsRef.current,
      trusted: hasWorkspace
        ? input.trusted ?? draftTrustedRef.current
        : null,
      workspaceSettings:
        input.workspaceSettings ?? draftWorkspaceSettingsRef.current,
    })
      .catch(() => undefined)
      .finally(() => {
        if (saveGenerationRef.current === generation) {
          setSaving(false);
        }
      });
  };

  const updateAppSettings = (nextSettings: AppSettings) => {
    draftAppSettingsRef.current = nextSettings;
    setDraftAppSettings(nextSettings);
    saveDraft({ appSettings: nextSettings });
  };

  const updateWorkspaceSettings = (nextSettings: WorkspaceSettings) => {
    draftWorkspaceSettingsRef.current = nextSettings;
    setDraftWorkspaceSettings(nextSettings);
    saveDraft({ workspaceSettings: nextSettings });
  };

  const updateTrusted = (trusted: boolean) => {
    draftTrustedRef.current = trusted;
    setDraftTrusted(trusted);
    saveDraft({ trusted });
  };

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
        <div className="settings-form">
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
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      intelligenceMode,
                    })
                  }
                  onChangeAutoSave={(autoSave) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      autoSave,
                      autoSaveConfigured: true,
                    })
                  }
                  onChangeRevealActiveFileInTree={(revealActiveFileInTree) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      revealActiveFileInTree,
                    })
                  }
                  onChangeTrusted={updateTrusted}
                  workspaceRoot={workspaceRoot}
                  workspaceSettings={draftWorkspaceSettings}
                />
              ) : null}

              {activeSection === "php" ? (
                <PhpSettings
                  hasWorkspace={hasWorkspace}
                  onChangePhpBackend={(phpBackend) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      phpBackend,
                    })
                  }
                  onChangeToolPath={(key, value) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      [key]: nullableInputValue(value),
                    })
                  }
                  phpTools={phpTools}
                  workspaceSettings={draftWorkspaceSettings}
                />
              ) : null}

              {activeSection === "index" ? (
                <IndexSettings
                  hasWorkspace={hasWorkspace}
                  ignorePatternsText={ignorePatternsText}
                  onChangeIgnorePatternsText={(value) => {
                    setIgnorePatternsText(value);
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      extraIgnorePatterns: settingsIgnorePatternsFromText(value),
                    });
                  }}
                />
              ) : null}

              {activeSection === "appearance" ? (
                <AppearanceSettings
                  appSettings={draftAppSettings}
                  onChangeTheme={(theme) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      theme,
                    })
                  }
                />
              ) : null}
            </div>
          </div>

          <footer className="settings-footer">
            <span aria-live="polite" className="settings-save-status">
              {saving ? "Saving..." : "Saved automatically"}
            </span>
            <button onClick={onClose} type="button">
              Done
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

interface GeneralSettingsProps {
  draftTrusted: boolean;
  hasWorkspace: boolean;
  workspaceRoot: string | null;
  workspaceSettings: WorkspaceSettings;
  onChangeAutoSave(autoSave: boolean): void;
  onChangeIntelligenceMode(mode: IntelligenceMode): void;
  onChangeRevealActiveFileInTree(enabled: boolean): void;
  onChangeTrusted(trusted: boolean): void;
}

function GeneralSettings({
  draftTrusted,
  hasWorkspace,
  onChangeAutoSave,
  onChangeIntelligenceMode,
  onChangeRevealActiveFileInTree,
  onChangeTrusted,
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
          disabled={!hasWorkspace}
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
          disabled={!hasWorkspace}
          onChange={(event) => onChangeAutoSave(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Auto Save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.revealActiveFileInTree}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeRevealActiveFileInTree(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>Reveal active file in tree</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={draftTrusted}
          disabled={!hasWorkspace}
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
  workspaceSettings,
}: PhpSettingsProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Backend</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangePhpBackend(
              event.currentTarget.value as PhpBackendPreference,
            )
          }
          value={workspaceSettings.phpBackend}
        >
          <option value="auto">Auto</option>
          <option value="phpactor">Managed PHP engine</option>
          <option value="intelephense">Intelephense</option>
        </select>
      </label>

      <label className="settings-field">
        <span>PHP engine path</span>
        <input
          disabled={!hasWorkspace}
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
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeToolPath("intelephensePath", event.currentTarget.value)
          }
          placeholder={detectedToolPath(phpTools?.intelephense)}
          value={workspaceSettings.intelephensePath || ""}
        />
      </label>

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

interface IndexSettingsProps {
  hasWorkspace: boolean;
  ignorePatternsText: string;
  onChangeIgnorePatternsText(value: string): void;
}

function IndexSettings({
  hasWorkspace,
  ignorePatternsText,
  onChangeIgnorePatternsText,
}: IndexSettingsProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Extra ignores</span>
        <textarea
          disabled={!hasWorkspace}
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
  onChangeTheme(theme: AppTheme): void;
}

function AppearanceSettings({
  appSettings,
  onChangeTheme,
}: AppearanceSettingsProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Theme</span>
        <select
          onChange={(event) =>
            onChangeTheme(event.currentTarget.value as AppTheme)
          }
          value={appSettings.theme}
        >
          {appThemeOptions.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
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
