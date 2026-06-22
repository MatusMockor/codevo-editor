import { Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultShortcutForCommand,
  keymapCommands,
  normalizeShortcutInput,
  type KeymapCommandId,
} from "../domain/keymap";
import {
  appThemeOptions,
  defaultEditorFontFamily,
  maxEditorFontSize,
  minEditorFontSize,
  normalizeEditorFontFamily,
  normalizeEditorFontSize,
  settingsIgnorePatternsFromText,
  settingsIgnorePatternsText,
  type AppSettings,
  type AppTheme,
  type BackgroundRuntimePolicy,
  type JavaScriptTypeScriptServiceMode,
  type JavaScriptTypeScriptVersionPreference,
  type PhpBackendPreference,
  type SettingsSection,
  type StatusBarItemVisibility,
  type WorkspaceSettings,
} from "../domain/settings";
import type { WorkspaceTrustState } from "../domain/trust";
import type {
  IntelligenceMode,
  WorkspaceDescriptor,
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
  initialSection?: SettingsSection;
  isOpen: boolean;
  phpTools: PhpToolAvailability | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
  workspaceSettings: WorkspaceSettings;
  workspaceTrust: WorkspaceTrustState | null;
  onClose(): void;
  onOpenJavaScriptTypeScriptServiceLog(): Promise<void>;
  onRestartJavaScriptTypeScriptService(): Promise<void>;
  onSave(input: SettingsSaveInput): Promise<void>;
}

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "general", label: "General" },
  { id: "keymap", label: "Keymap" },
  { id: "php", label: "PHP" },
  { id: "index", label: "Index" },
  { id: "appearance", label: "Appearance" },
];

export function SettingsDialog({
  appSettings,
  initialSection = "general",
  isOpen,
  onClose,
  onOpenJavaScriptTypeScriptServiceLog,
  onRestartJavaScriptTypeScriptService,
  onSave,
  phpTools,
  workspaceDescriptor,
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
  const draftAppSettingsRef = useRef(appSettings);
  const draftWorkspaceSettingsRef = useRef(workspaceSettings);
  const draftTrustedRef = useRef(false);
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
    setActiveSection(initialSection);
    setDraftAppSettings(appSettings);
    setDraftWorkspaceSettings(workspaceSettings);
    setDraftTrusted(Boolean(workspaceTrust?.trusted));
    draftAppSettingsRef.current = appSettings;
    draftWorkspaceSettingsRef.current = workspaceSettings;
    draftTrustedRef.current = Boolean(workspaceTrust?.trusted);
    setIgnorePatternsText(
      settingsIgnorePatternsText(workspaceSettings.extraIgnorePatterns),
    );
  }, [appSettings, initialSection, isOpen, workspaceSettings, workspaceTrust]);

  useEffect(() => {
    if (isOpen) {
      setActiveSection(initialSection);
    }
  }, [initialSection, isOpen]);

  const selectedSectionLabel = useMemo(() => {
    const section = sections.find((item) => item.id === activeSection);
    return section?.label || "Settings";
  }, [activeSection]);

  if (!isOpen) {
    return null;
  }

  const saveDraft = (input: Partial<SettingsSaveInput>) => {
    void onSave({
      appSettings: input.appSettings ?? draftAppSettingsRef.current,
      trusted: hasWorkspace
        ? input.trusted ?? draftTrustedRef.current
        : null,
      workspaceSettings:
        input.workspaceSettings ?? draftWorkspaceSettingsRef.current,
    }).catch(() => undefined);
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
                  appSettings={draftAppSettings}
                  draftTrusted={draftTrusted}
                  hasWorkspace={hasWorkspace}
                  onChangeRuntimePolicy={(runtimePolicy) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      runtimePolicy,
                    })
                  }
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
                  onChangeFormatOnPaste={(formatOnPaste) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      formatOnPaste,
                    })
                  }
                  onChangeFormatOnSave={(formatOnSave) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      formatOnSave,
                    })
                  }
                  onChangeJavaScriptTypeScriptService={(
                    javaScriptTypeScriptService,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptService,
                    })
                  }
                  onChangeJavaScriptTypeScriptAutoImports={(
                    javaScriptTypeScriptAutoImports,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptAutoImports,
                    })
                  }
                  onChangeJavaScriptTypeScriptCodeLens={(
                    javaScriptTypeScriptCodeLens,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptCodeLens,
                    })
                  }
                  onChangeJavaScriptTypeScriptInlayHints={(
                    javaScriptTypeScriptInlayHints,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptInlayHints,
                    })
                  }
                  onChangeJavaScriptTypeScriptValidation={(
                    javaScriptTypeScriptValidation,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptValidation,
                    })
                  }
                  onChangeJavaScriptTypeScriptVersion={(
                    javaScriptTypeScriptVersion,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptVersion,
                    })
                  }
                  onChangeRevealActiveFileInTree={(revealActiveFileInTree) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      revealActiveFileInTree,
                    })
                  }
                  onChangeStatusBarVisibility={(key, visible) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      statusBar: {
                        ...draftWorkspaceSettingsRef.current.statusBar,
                        [key]: visible,
                      },
                    })
                  }
                  onChangeTrusted={updateTrusted}
                  onRestartJavaScriptTypeScriptService={
                    onRestartJavaScriptTypeScriptService
                  }
                  onOpenJavaScriptTypeScriptServiceLog={
                    onOpenJavaScriptTypeScriptServiceLog
                  }
                  workspaceRoot={workspaceRoot}
                  workspaceSettings={draftWorkspaceSettings}
                />
              ) : null}

              {activeSection === "keymap" ? (
                <KeymapSettingsPanel
                  appSettings={draftAppSettings}
                  onChangeShortcut={(commandId, shortcut) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      keymap: {
                        ...draftAppSettingsRef.current.keymap,
                        [commandId]: normalizeShortcutInput(shortcut),
                      },
                    })
                  }
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
                  onChangePhpVersionOverride={(phpVersionOverride) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      phpVersionOverride: nullableInputValue(phpVersionOverride),
                    })
                  }
                  onChangeToolPath={(key, value) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      [key]: nullableInputValue(value),
                    })
                  }
                  phpTools={phpTools}
                  workspaceDescriptor={workspaceDescriptor}
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
                  onChangeEditorFontFamily={(editorFontFamily) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      editorFontFamily:
                        normalizeEditorFontFamily(editorFontFamily),
                    })
                  }
                  onChangeEditorFontLigatures={(editorFontLigatures) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      editorFontLigatures,
                    })
                  }
                  onChangeEditorFontSize={(editorFontSize) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      editorFontSize: normalizeEditorFontSize(editorFontSize),
                    })
                  }
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
        </div>
      </section>
    </div>
  );
}

interface GeneralSettingsProps {
  appSettings: AppSettings;
  draftTrusted: boolean;
  hasWorkspace: boolean;
  workspaceRoot: string | null;
  workspaceSettings: WorkspaceSettings;
  onChangeAutoSave(autoSave: boolean): void;
  onChangeFormatOnPaste(formatOnPaste: boolean): void;
  onChangeFormatOnSave(formatOnSave: boolean): void;
  onChangeIntelligenceMode(mode: IntelligenceMode): void;
  onChangeJavaScriptTypeScriptService(
    mode: JavaScriptTypeScriptServiceMode,
  ): void;
  onChangeJavaScriptTypeScriptAutoImports(enabled: boolean): void;
  onChangeJavaScriptTypeScriptCodeLens(enabled: boolean): void;
  onChangeJavaScriptTypeScriptInlayHints(enabled: boolean): void;
  onChangeJavaScriptTypeScriptValidation(enabled: boolean): void;
  onChangeJavaScriptTypeScriptVersion(
    preference: JavaScriptTypeScriptVersionPreference,
  ): void;
  onChangeRevealActiveFileInTree(enabled: boolean): void;
  onChangeRuntimePolicy(policy: BackgroundRuntimePolicy): void;
  onChangeStatusBarVisibility(
    key: keyof StatusBarItemVisibility,
    visible: boolean,
  ): void;
  onChangeTrusted(trusted: boolean): void;
  onOpenJavaScriptTypeScriptServiceLog(): Promise<void>;
  onRestartJavaScriptTypeScriptService(): Promise<void>;
}

function GeneralSettings({
  appSettings,
  draftTrusted,
  hasWorkspace,
  onChangeAutoSave,
  onChangeFormatOnPaste,
  onChangeFormatOnSave,
  onChangeIntelligenceMode,
  onChangeJavaScriptTypeScriptAutoImports,
  onChangeJavaScriptTypeScriptCodeLens,
  onChangeJavaScriptTypeScriptInlayHints,
  onChangeJavaScriptTypeScriptService,
  onChangeJavaScriptTypeScriptValidation,
  onChangeJavaScriptTypeScriptVersion,
  onChangeRevealActiveFileInTree,
  onChangeRuntimePolicy,
  onChangeStatusBarVisibility,
  onChangeTrusted,
  onOpenJavaScriptTypeScriptServiceLog,
  onRestartJavaScriptTypeScriptService,
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

      <label className="settings-field">
        <span>JavaScript/TypeScript service</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptService(
              event.currentTarget.value as JavaScriptTypeScriptServiceMode,
            )
          }
          value={workspaceSettings.javaScriptTypeScriptService}
        >
          <option value="auto">Auto</option>
          <option value="off">Off</option>
        </select>
      </label>

      <label className="settings-field">
        <span>TypeScript version</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptVersion(
              event.currentTarget
                .value as JavaScriptTypeScriptVersionPreference,
            )
          }
          value={workspaceSettings.javaScriptTypeScriptVersion}
        >
          <option value="bundled">Bundled</option>
          <option value="workspace">Workspace</option>
        </select>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptValidation}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptValidation(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>JavaScript/TypeScript validation</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptAutoImports}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptAutoImports(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>JavaScript/TypeScript auto imports</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptInlayHints}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptInlayHints(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>JavaScript/TypeScript inlay hints</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptCodeLens}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptCodeLens(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>JavaScript/TypeScript CodeLens</span>
      </label>

      <div className="settings-actions">
        <button
          disabled={
            !hasWorkspace ||
            workspaceSettings.javaScriptTypeScriptService === "off"
          }
          onClick={() => void onRestartJavaScriptTypeScriptService()}
          type="button"
        >
          Restart JavaScript/TypeScript service
        </button>
        <button
          disabled={!hasWorkspace}
          onClick={() => void onOpenJavaScriptTypeScriptServiceLog()}
          type="button"
        >
          Open JavaScript/TypeScript service log
        </button>
      </div>

      <label className="settings-field">
        <span>Background IDE engines</span>
        <select
          onChange={(event) =>
            onChangeRuntimePolicy(
              event.currentTarget.value as BackgroundRuntimePolicy,
            )
          }
          value={appSettings.runtimePolicy}
        >
          <option value="keepAlive">Keep project engines alive</option>
          <option value="suspendOnBackground">Suspend background projects</option>
          <option value="singleActive">Only active project runs IDE</option>
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
          checked={workspaceSettings.formatOnSave}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeFormatOnSave(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Format on Save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.formatOnPaste}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeFormatOnPaste(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>Format on Paste</span>
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

      <div className="settings-subgroup">
        <span>Status bar</span>
        {statusBarItems.map((item) => (
          <label className="settings-toggle" key={item.key}>
            <input
              checked={workspaceSettings.statusBar[item.key]}
              disabled={!hasWorkspace}
              onChange={(event) =>
                onChangeStatusBarVisibility(
                  item.key,
                  event.currentTarget.checked,
                )
              }
              type="checkbox"
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const statusBarItems: Array<{
  key: keyof StatusBarItemVisibility;
  label: string;
}> = [
  { key: "activePath", label: "File path" },
  { key: "workspaceInfo", label: "Project info" },
  { key: "index", label: "Index" },
  { key: "languageServer", label: "IDE engine" },
  { key: "workspaceTrust", label: "Trust" },
  { key: "mode", label: "Mode" },
  { key: "language", label: "Language" },
  { key: "dirtyCount", label: "Unsaved files" },
  { key: "message", label: "Messages" },
];

interface KeymapSettingsPanelProps {
  appSettings: AppSettings;
  onChangeShortcut(commandId: KeymapCommandId, shortcut: string): void;
}

function KeymapSettingsPanel({
  appSettings,
  onChangeShortcut,
}: KeymapSettingsPanelProps) {
  return (
    <div className="settings-group">
      {keymapCommands.map((command) => (
        <label className="settings-field keymap-field" key={command.id}>
          <span>
            <strong>{command.label}</strong>
            <small>{command.category}</small>
          </span>
          <input
            onBlur={(event) =>
              onChangeShortcut(command.id, event.currentTarget.value)
            }
            onChange={(event) =>
              onChangeShortcut(command.id, event.currentTarget.value)
            }
            placeholder={defaultShortcutForCommand(command.id)}
            spellCheck={false}
            value={appSettings.keymap[command.id]}
          />
        </label>
      ))}
    </div>
  );
}

interface PhpSettingsProps {
  hasWorkspace: boolean;
  phpTools: PhpToolAvailability | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceSettings: WorkspaceSettings;
  onChangePhpBackend(backend: PhpBackendPreference): void;
  onChangePhpVersionOverride(version: string): void;
  onChangeToolPath(
    key: "phpactorPath" | "intelephensePath",
    value: string,
  ): void;
}

function PhpSettings({
  hasWorkspace,
  onChangePhpBackend,
  onChangePhpVersionOverride,
  onChangeToolPath,
  phpTools,
  workspaceDescriptor,
  workspaceSettings,
}: PhpSettingsProps) {
  const detectedPhpVersion = detectedComposerPhpVersion(workspaceDescriptor);
  const effectivePhpVersion =
    workspaceSettings.phpVersionOverride || detectedPhpVersion || "Auto";

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
        <span>PHP language level override</span>
        <input
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangePhpVersionOverride(event.currentTarget.value)
          }
          placeholder={detectedPhpVersion || "Composer / Auto"}
          value={workspaceSettings.phpVersionOverride || ""}
        />
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
  onChangeEditorFontFamily(value: string): void;
  onChangeEditorFontLigatures(enabled: boolean): void;
  onChangeEditorFontSize(value: number): void;
  onChangeTheme(theme: AppTheme): void;
}

function AppearanceSettings({
  appSettings,
  onChangeEditorFontFamily,
  onChangeEditorFontLigatures,
  onChangeEditorFontSize,
  onChangeTheme,
}: AppearanceSettingsProps) {
  const [fontFamilyOptions, setFontFamilyOptions] = useState(
    defaultEditorFontFamilyOptions,
  );
  const queryLocalFonts = (globalThis as LocalFontQueryGlobal).queryLocalFonts;
  const canQueryLocalFonts = typeof queryLocalFonts === "function";
  const visibleFontFamilyOptions = useMemo(
    () =>
      uniqueSortedStrings([
        ...fontFamilyOptions,
        appSettings.editorFontFamily,
      ]),
    [appSettings.editorFontFamily, fontFamilyOptions],
  );

  const loadInstalledFonts = async () => {
    if (!queryLocalFonts) {
      return;
    }

    try {
      const localFonts = await queryLocalFonts();
      const localFamilies = localFonts
        .map((font) => font.family.trim())
        .filter(Boolean);

      setFontFamilyOptions((current) =>
        uniqueSortedStrings([...current, ...localFamilies]),
      );
    } catch {
      setFontFamilyOptions(defaultEditorFontFamilyOptions);
    }
  };

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

      <label className="settings-field">
        <span>Font family</span>
        <select
          onChange={(event) =>
            onChangeEditorFontFamily(event.currentTarget.value)
          }
          value={appSettings.editorFontFamily}
        >
          {visibleFontFamilyOptions.map((fontFamily) => (
            <option key={fontFamily} value={fontFamily}>
              {fontFamily}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-actions">
        <button
          disabled={!canQueryLocalFonts}
          onClick={() => void loadInstalledFonts()}
          type="button"
        >
          Load installed fonts
        </button>
      </div>

      <label className="settings-field">
        <span>Font size</span>
        <input
          max={maxEditorFontSize}
          min={minEditorFontSize}
          onChange={(event) =>
            onChangeEditorFontSize(event.currentTarget.valueAsNumber)
          }
          type="number"
          value={appSettings.editorFontSize}
        />
      </label>

      <label className="settings-toggle">
        <input
          checked={appSettings.editorFontLigatures}
          onChange={(event) =>
            onChangeEditorFontLigatures(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>Font ligatures</span>
      </label>
    </div>
  );
}

interface LocalFontData {
  family: string;
}

type LocalFontQueryGlobal = typeof globalThis & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

const defaultEditorFontFamilyOptions = uniqueSortedStrings([
  defaultEditorFontFamily,
  "Berkeley Mono",
  "Cascadia Code",
  "Consolas",
  "Fira Code",
  "Hack",
  "IBM Plex Mono",
  "Iosevka",
  "JetBrains Mono",
  "Menlo",
  "Monaco",
  "Roboto Mono",
  "SFMono-Regular",
  "Source Code Pro",
  "Ubuntu Mono",
  "monospace",
]);

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
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
