import { Search, Settings2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultShortcutForCommand,
  findKeymapConflicts,
  keymapCommands,
  normalizeShortcutInput,
  shortcutFromKeyboardEvent,
  type KeymapCommandId,
} from "../domain/keymap";
import {
  appThemeOptions,
  maxEditorFontSize,
  minEditorFontSize,
  normalizeEditorFontFamily,
  normalizeEditorFontSize,
  settingsIgnorePatternsFromText,
  settingsIgnorePatternsText,
  type AppSettings,
  type AppTheme,
  type BackgroundRuntimePolicy,
  type JavaScriptTypeScriptImportModuleSpecifierEnding,
  type JavaScriptTypeScriptImportModuleSpecifierPreference,
  type JavaScriptTypeScriptQuotePreference,
  type JavaScriptTypeScriptServiceMode,
  type JavaScriptTypeScriptVersionPreference,
  type PhpBackendPreference,
  type SettingsSection,
  type StatusBarItemVisibility,
  type WorkspaceSettings,
} from "../domain/settings";
import {
  gitDirectoryMappingPaths,
  normalizeGitDirectoryMappings,
} from "../domain/gitRepositoryMapping";
import type { UserSnippet } from "../domain/snippets";
import type { SystemFontGateway } from "../domain/systemFonts";
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
  /**
   * Auto-detected git repository directories (workspace-root-relative, excluding
   * the root), shown as read-only, "Auto-detected"-marked entries in the
   * Directory Mappings section alongside the editable manual mappings.
   */
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
  onRestartJavaScriptTypeScriptService(): Promise<void>;
  onSave(input: SettingsSaveInput): Promise<void>;
}

const emptySystemFontGateway: SystemFontGateway = {
  listMonospaceFontFamilies: async () => [],
};

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "general", label: "General" },
  { id: "keymap", label: "Keymap" },
  { id: "php", label: "PHP" },
  { id: "git", label: "Directory Mappings" },
  { id: "index", label: "Index" },
  { id: "snippets", label: "Snippets" },
  { id: "appearance", label: "Appearance" },
];

const newUserSnippet = (): UserSnippet => ({
  prefix: "",
  body: "",
  description: "",
  languages: ["php"],
});

export function SettingsDialog({
  appSettings,
  gitDetectedRepositoryMappings = [],
  initialSection = "general",
  isOpen,
  onClose,
  onOpenJavaScriptTypeScriptServiceLog,
  onRestartJavaScriptTypeScriptService,
  onSave,
  phpTools,
  systemFontGateway = emptySystemFontGateway,
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
                  onChangeDefaultInsertSpaces={(defaultInsertSpaces) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      defaultInsertSpaces,
                    })
                  }
                  onChangeDefaultTabSize={(defaultTabSize) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      defaultTabSize,
                    })
                  }
                  onChangeOptimizeImportsOnSave={(optimizeImportsOnSave) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      optimizeImportsOnSave,
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
                  onChangeJavaScriptTypeScriptAutomaticTypeAcquisition={(
                    javaScriptTypeScriptAutomaticTypeAcquisition,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptAutomaticTypeAcquisition,
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
                  onChangeJavaScriptTypeScriptReferencesCodeLensOnAllFunctions={(
                    javaScriptTypeScriptReferencesCodeLensOnAllFunctions,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptReferencesCodeLensOnAllFunctions,
                    })
                  }
                  onChangeJavaScriptTypeScriptCompleteFunctionCalls={(
                    javaScriptTypeScriptCompleteFunctionCalls,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptCompleteFunctionCalls,
                    })
                  }
                  onChangeJavaScriptTypeScriptImportModuleSpecifierPreference={(
                    javaScriptTypeScriptImportModuleSpecifierPreference,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptImportModuleSpecifierPreference,
                    })
                  }
                  onChangeJavaScriptTypeScriptImportModuleSpecifierEnding={(
                    javaScriptTypeScriptImportModuleSpecifierEnding,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptImportModuleSpecifierEnding,
                    })
                  }
                  onChangeJavaScriptTypeScriptAddMissingImportsOnSave={(
                    javaScriptTypeScriptAddMissingImportsOnSave,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptAddMissingImportsOnSave,
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
                  onChangeJavaScriptTypeScriptFixAllOnSave={(
                    javaScriptTypeScriptFixAllOnSave,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptFixAllOnSave,
                    })
                  }
                  onChangeJavaScriptTypeScriptOrganizeImportsOnSave={(
                    javaScriptTypeScriptOrganizeImportsOnSave,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptOrganizeImportsOnSave,
                    })
                  }
                  onChangeJavaScriptTypeScriptPreferTypeOnlyAutoImports={(
                    javaScriptTypeScriptPreferTypeOnlyAutoImports,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptPreferTypeOnlyAutoImports,
                    })
                  }
                  onChangeJavaScriptTypeScriptQuotePreference={(
                    javaScriptTypeScriptQuotePreference,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptQuotePreference,
                    })
                  }
                  onChangeJavaScriptTypeScriptRemoveUnusedOnSave={(
                    javaScriptTypeScriptRemoveUnusedOnSave,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptRemoveUnusedOnSave,
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
                  onChangePhpInlayHints={(phpInlayHints) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      phpInlayHints,
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

              {activeSection === "git" ? (
                <GitMappingsSettings
                  detectedMappings={gitDetectedRepositoryMappings}
                  gitDirectoryMappings={
                    draftWorkspaceSettings.gitDirectoryMappings
                  }
                  gitDirectoryMappingsAuto={
                    draftWorkspaceSettings.gitDirectoryMappingsAuto
                  }
                  hasWorkspace={hasWorkspace}
                  onChangeGitDirectoryMappings={(gitDirectoryMappings) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      gitDirectoryMappings,
                    })
                  }
                  onChangeGitDirectoryMappingsAuto={(
                    gitDirectoryMappingsAuto,
                  ) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      gitDirectoryMappingsAuto,
                    })
                  }
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

              {activeSection === "snippets" ? (
                <SnippetsSettings
                  userSnippets={draftAppSettings.userSnippets}
                  onChangeUserSnippets={(userSnippets) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      userSnippets,
                    })
                  }
                />
              ) : null}

              {activeSection === "appearance" ? (
                <AppearanceSettings
                  appSettings={draftAppSettings}
                  systemFontGateway={systemFontGateway}
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
  onChangeDefaultInsertSpaces(defaultInsertSpaces: boolean): void;
  onChangeDefaultTabSize(defaultTabSize: number): void;
  onChangeFormatOnPaste(formatOnPaste: boolean): void;
  onChangeFormatOnSave(formatOnSave: boolean): void;
  onChangeOptimizeImportsOnSave(optimizeImportsOnSave: boolean): void;
  onChangeIntelligenceMode(mode: IntelligenceMode): void;
  onChangeJavaScriptTypeScriptService(
    mode: JavaScriptTypeScriptServiceMode,
  ): void;
  onChangeJavaScriptTypeScriptAutoImports(enabled: boolean): void;
  onChangeJavaScriptTypeScriptAutomaticTypeAcquisition(enabled: boolean): void;
  onChangeJavaScriptTypeScriptAddMissingImportsOnSave(enabled: boolean): void;
  onChangeJavaScriptTypeScriptCodeLens(enabled: boolean): void;
  onChangeJavaScriptTypeScriptReferencesCodeLensOnAllFunctions(
    enabled: boolean,
  ): void;
  onChangeJavaScriptTypeScriptCompleteFunctionCalls(enabled: boolean): void;
  onChangeJavaScriptTypeScriptFixAllOnSave(enabled: boolean): void;
  onChangeJavaScriptTypeScriptImportModuleSpecifierPreference(
    preference: JavaScriptTypeScriptImportModuleSpecifierPreference,
  ): void;
  onChangeJavaScriptTypeScriptImportModuleSpecifierEnding(
    ending: JavaScriptTypeScriptImportModuleSpecifierEnding,
  ): void;
  onChangeJavaScriptTypeScriptInlayHints(enabled: boolean): void;
  onChangeJavaScriptTypeScriptOrganizeImportsOnSave(enabled: boolean): void;
  onChangeJavaScriptTypeScriptPreferTypeOnlyAutoImports(enabled: boolean): void;
  onChangeJavaScriptTypeScriptQuotePreference(
    preference: JavaScriptTypeScriptQuotePreference,
  ): void;
  onChangeJavaScriptTypeScriptRemoveUnusedOnSave(enabled: boolean): void;
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
  onChangeDefaultInsertSpaces,
  onChangeDefaultTabSize,
  onChangeFormatOnPaste,
  onChangeFormatOnSave,
  onChangeOptimizeImportsOnSave,
  onChangeIntelligenceMode,
  onChangeJavaScriptTypeScriptAutoImports,
  onChangeJavaScriptTypeScriptAutomaticTypeAcquisition,
  onChangeJavaScriptTypeScriptAddMissingImportsOnSave,
  onChangeJavaScriptTypeScriptCodeLens,
  onChangeJavaScriptTypeScriptReferencesCodeLensOnAllFunctions,
  onChangeJavaScriptTypeScriptCompleteFunctionCalls,
  onChangeJavaScriptTypeScriptFixAllOnSave,
  onChangeJavaScriptTypeScriptImportModuleSpecifierEnding,
  onChangeJavaScriptTypeScriptImportModuleSpecifierPreference,
  onChangeJavaScriptTypeScriptInlayHints,
  onChangeJavaScriptTypeScriptOrganizeImportsOnSave,
  onChangeJavaScriptTypeScriptPreferTypeOnlyAutoImports,
  onChangeJavaScriptTypeScriptQuotePreference,
  onChangeJavaScriptTypeScriptRemoveUnusedOnSave,
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

      <label className="settings-field">
        <span>JS/TS import module specifier</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptImportModuleSpecifierPreference(
              event.currentTarget
                .value as JavaScriptTypeScriptImportModuleSpecifierPreference,
            )
          }
          value={
            workspaceSettings.javaScriptTypeScriptImportModuleSpecifierPreference
          }
        >
          <option value="shortest">Shortest</option>
          <option value="relative">Relative</option>
          <option value="non-relative">Non-relative</option>
          <option value="project-relative">Project-relative</option>
        </select>
      </label>

      <label className="settings-field">
        <span>JS/TS import module specifier ending</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptImportModuleSpecifierEnding(
              event.currentTarget
                .value as JavaScriptTypeScriptImportModuleSpecifierEnding,
            )
          }
          value={workspaceSettings.javaScriptTypeScriptImportModuleSpecifierEnding}
        >
          <option value="auto">Auto</option>
          <option value="minimal">Minimal</option>
          <option value="index">Index</option>
          <option value="js">JS</option>
        </select>
      </label>

      <label className="settings-field">
        <span>JS/TS import quotes</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptQuotePreference(
              event.currentTarget.value as JavaScriptTypeScriptQuotePreference,
            )
          }
          value={workspaceSettings.javaScriptTypeScriptQuotePreference}
        >
          <option value="auto">Auto</option>
          <option value="single">Single</option>
          <option value="double">Double</option>
        </select>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptPreferTypeOnlyAutoImports}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptPreferTypeOnlyAutoImports(
              event.currentTarget.checked,
            )
          }
          type="checkbox"
        />
        <span>JS/TS prefer type-only auto imports</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={
            workspaceSettings.javaScriptTypeScriptAutomaticTypeAcquisition
          }
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptAutomaticTypeAcquisition(
              event.currentTarget.checked,
            )
          }
          type="checkbox"
        />
        <span>JavaScript/TypeScript automatic type acquisition</span>
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

      <label className="settings-toggle">
        <input
          checked={
            workspaceSettings.javaScriptTypeScriptReferencesCodeLensOnAllFunctions
          }
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptReferencesCodeLensOnAllFunctions(
              event.currentTarget.checked,
            )
          }
          type="checkbox"
        />
        <span>JS/TS reference CodeLens on all functions</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptCompleteFunctionCalls}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptCompleteFunctionCalls(
              event.currentTarget.checked,
            )
          }
          type="checkbox"
        />
        <span>JS/TS complete function calls</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptOrganizeImportsOnSave}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptOrganizeImportsOnSave(
              event.currentTarget.checked,
            )
          }
          type="checkbox"
        />
        <span>JS/TS organize imports on save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptRemoveUnusedOnSave}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptRemoveUnusedOnSave(
              event.currentTarget.checked,
            )
          }
          type="checkbox"
        />
        <span>JS/TS remove unused on save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptAddMissingImportsOnSave}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptAddMissingImportsOnSave(
              event.currentTarget.checked,
            )
          }
          type="checkbox"
        />
        <span>JS/TS add missing imports on save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptFixAllOnSave}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptFixAllOnSave(
              event.currentTarget.checked,
            )
          }
          type="checkbox"
        />
        <span>JS/TS fix all on save</span>
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
          checked={workspaceSettings.optimizeImportsOnSave}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeOptimizeImportsOnSave(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>Optimize imports on save</span>
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

      <label className="settings-field">
        <span>Default tab size</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeDefaultTabSize(Number(event.currentTarget.value))
          }
          value={workspaceSettings.defaultTabSize}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((tabSize) => (
            <option key={tabSize} value={tabSize}>
              {tabSize}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.defaultInsertSpaces}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeDefaultInsertSpaces(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>Insert spaces by default</span>
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
  { key: "largeFileMode", label: "Large file mode" },
  { key: "workspaceTrust", label: "Trust" },
  { key: "mode", label: "Mode" },
  { key: "language", label: "Language" },
  { key: "cursorPosition", label: "Cursor position" },
  { key: "gitBranch", label: "Git branch" },
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
  const [filter, setFilter] = useState("");

  const visibleCommands = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();

    if (!normalizedFilter) {
      return keymapCommands;
    }

    return keymapCommands.filter((command) => {
      const shortcut =
        appSettings.keymap[command.id] || defaultShortcutForCommand(command.id);
      const haystack = `${command.label} ${command.category} ${command.id} ${shortcut}`;
      return haystack.toLowerCase().includes(normalizedFilter);
    });
  }, [appSettings.keymap, filter]);

  return (
    <div className="settings-group">
      <div className="palette-search keymap-search">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label="Filter shortcuts"
          onChange={(event) => setFilter(event.currentTarget.value)}
          placeholder="Filter shortcuts"
          spellCheck={false}
          value={filter}
        />
      </div>

      {visibleCommands.length === 0 ? (
        <div className="keymap-empty">No matching shortcuts</div>
      ) : null}

      {visibleCommands.map((command) => {
        const conflicts = findKeymapConflicts(appSettings.keymap, command.id);

        return (
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
              onKeyDown={(event) => {
                // "Press the keys" capture (PhpStorm/VS Code keybinding editor
                // convention): a real chord is bound immediately instead of
                // requiring the user to type its name out. Everything that is
                // not a standalone chord falls through (bare taps, Shift-typed
                // characters like "+" or capitals, Shift+Tab), so Tab/Escape/
                // Backspace keep their normal behaviour and typing free-form
                // text into the field still works.
                const captured = shortcutFromKeyboardEvent(event);

                if (!captured) {
                  return;
                }

                event.preventDefault();
                onChangeShortcut(command.id, captured);
              }}
              placeholder={defaultShortcutForCommand(command.id)}
              spellCheck={false}
              value={appSettings.keymap[command.id]}
            />
            {conflicts.length > 0 ? (
              <small className="keymap-conflict" role="alert">
                <TriangleAlert aria-hidden="true" size={12} />
                Also used by {conflicts.map((conflict) => conflict.label).join(", ")}
              </small>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

interface PhpSettingsProps {
  hasWorkspace: boolean;
  phpTools: PhpToolAvailability | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceSettings: WorkspaceSettings;
  onChangePhpBackend(backend: PhpBackendPreference): void;
  onChangePhpInlayHints(enabled: boolean): void;
  onChangePhpVersionOverride(version: string): void;
  onChangeToolPath(
    key: "phpactorPath" | "intelephensePath",
    value: string,
  ): void;
}

function PhpSettings({
  hasWorkspace,
  onChangePhpBackend,
  onChangePhpInlayHints,
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

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.phpInlayHints}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangePhpInlayHints(event.currentTarget.checked)
          }
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

interface GitMappingsSettingsProps {
  detectedMappings: string[];
  gitDirectoryMappings: string[];
  gitDirectoryMappingsAuto: boolean;
  hasWorkspace: boolean;
  onChangeGitDirectoryMappings(mappings: string[]): void;
  onChangeGitDirectoryMappingsAuto(auto: boolean): void;
}

// PhpStorm-style Git "Directory Mappings": the workspace's main repository plus
// nested package repositories. Auto-detected repositories are shown read-only
// (marked "Auto-detected"); manual mappings are editable. A file's git
// operations route into the repository that owns it.
function GitMappingsSettings({
  detectedMappings,
  gitDirectoryMappings,
  gitDirectoryMappingsAuto,
  hasWorkspace,
  onChangeGitDirectoryMappings,
  onChangeGitDirectoryMappingsAuto,
}: GitMappingsSettingsProps) {
  const [draftPath, setDraftPath] = useState("");
  const manualByKey = new Set(
    gitDirectoryMappings.map((path) => path.toLowerCase()),
  );
  const autoOnlyMappings = detectedMappings.filter(
    (path) => path !== "" && !manualByKey.has(path.toLowerCase()),
  );

  const addMapping = () => {
    const nextMappings = gitDirectoryMappingPaths(
      normalizeGitDirectoryMappings([...gitDirectoryMappings, draftPath]),
    ).filter((path) => path !== "");

    onChangeGitDirectoryMappings(nextMappings);
    setDraftPath("");
  };

  const removeMapping = (path: string) => {
    onChangeGitDirectoryMappings(
      gitDirectoryMappings.filter((mapping) => mapping !== path),
    );
  };

  return (
    <div className="settings-group">
      <p className="settings-hint">
        Route git operations per directory: a workspace can hold a main
        repository at its root plus nested package repositories (for example{" "}
        <code>workbench/lcsk/*</code>). Each file commits and pushes into the
        repository that owns it.
      </p>

      <label className="settings-toggle">
        <input
          checked={gitDirectoryMappingsAuto}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeGitDirectoryMappingsAuto(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>Detect repositories automatically</span>
      </label>

      {gitDirectoryMappingsAuto && autoOnlyMappings.length > 0 ? (
        <div className="settings-subgroup">
          <span>Detected repositories</span>
          {autoOnlyMappings.map((path) => (
            <div className="git-mapping-row" key={path}>
              <code className="git-mapping-path">{path}</code>
              <span className="git-mapping-badge">Auto-detected</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="settings-subgroup">
        <span>Manual repositories</span>
        {gitDirectoryMappings.length === 0 ? (
          <div className="settings-readout">
            <span>No manual mappings</span>
          </div>
        ) : null}
        {gitDirectoryMappings.map((path) => (
          <div className="git-mapping-row" key={path}>
            <code className="git-mapping-path">{path}</code>
            <button
              disabled={!hasWorkspace}
              onClick={() => removeMapping(path)}
              title="Remove mapping"
              type="button"
            >
              Remove
            </button>
          </div>
        ))}

        <label className="settings-field">
          <span>Add repository directory</span>
          <input
            disabled={!hasWorkspace}
            onChange={(event) => setDraftPath(event.currentTarget.value)}
            placeholder="workbench/lcsk/attendance"
            spellCheck={false}
            value={draftPath}
          />
        </label>
        <div className="settings-actions">
          <button
            disabled={!hasWorkspace || draftPath.trim() === ""}
            onClick={addMapping}
            type="button"
          >
            Add
          </button>
        </div>
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

export const snippetLanguageOptions: Array<{ id: string; label: string }> = [
  { id: "php", label: "PHP" },
  { id: "blade", label: "Blade" },
  { id: "latte", label: "Latte" },
  { id: "neon", label: "NEON" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "javascriptreact", label: "JavaScript React" },
  { id: "typescriptreact", label: "TypeScript React" },
];

interface SnippetsSettingsProps {
  userSnippets: UserSnippet[];
  onChangeUserSnippets(snippets: UserSnippet[]): void;
}

function SnippetsSettings({
  userSnippets,
  onChangeUserSnippets,
}: SnippetsSettingsProps) {
  const updateSnippetAt = (index: number, patch: Partial<UserSnippet>) => {
    onChangeUserSnippets(
      userSnippets.map((snippet, position) =>
        position === index ? { ...snippet, ...patch } : snippet,
      ),
    );
  };

  const removeSnippetAt = (index: number) => {
    onChangeUserSnippets(
      userSnippets.filter((_snippet, position) => position !== index),
    );
  };

  const toggleLanguage = (index: number, language: string, on: boolean) => {
    const current = userSnippets[index].languages;
    const next = on
      ? Array.from(new Set([...current, language]))
      : current.filter((id) => id !== language);

    updateSnippetAt(index, { languages: next });
  };

  return (
    <div className="settings-group">
      <p className="settings-hint">
        Live templates expand a typed prefix using Monaco snippet syntax
        (<code>$1</code>, <code>${"{1:default}"}</code>, <code>$0</code>). User
        snippets are shared across every project and override a built-in with the
        same prefix and language.
      </p>

      <div className="settings-actions">
        <button
          onClick={() => onChangeUserSnippets([...userSnippets, newUserSnippet()])}
          type="button"
        >
          Add snippet
        </button>
      </div>

      {userSnippets.length === 0 ? (
        <div className="settings-readout">
          <span>No user snippets yet</span>
        </div>
      ) : null}

      {userSnippets.map((snippet, index) => (
        <div className="settings-subgroup snippet-editor" key={index}>
          <label className="settings-field">
            <span>Prefix</span>
            <input
              data-snippet-field="prefix"
              onChange={(event) =>
                updateSnippetAt(index, { prefix: event.currentTarget.value })
              }
              placeholder="myhelper"
              spellCheck={false}
              value={snippet.prefix}
            />
          </label>

          <label className="settings-field">
            <span>Description</span>
            <input
              data-snippet-field="description"
              onChange={(event) =>
                updateSnippetAt(index, {
                  description: event.currentTarget.value,
                })
              }
              value={snippet.description}
            />
          </label>

          <label className="settings-field">
            <span>Body</span>
            <textarea
              data-snippet-field="body"
              onChange={(event) =>
                updateSnippetAt(index, { body: event.currentTarget.value })
              }
              rows={5}
              spellCheck={false}
              value={snippet.body}
            />
          </label>

          <div className="settings-subgroup">
            <span>Languages</span>
            {snippetLanguageOptions.map((option) => (
              <label className="settings-toggle" key={option.id}>
                <input
                  checked={snippet.languages.includes(option.id)}
                  onChange={(event) =>
                    toggleLanguage(index, option.id, event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>

          <div className="settings-actions">
            <button onClick={() => removeSnippetAt(index)} type="button">
              Delete snippet
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface AppearanceSettingsProps {
  appSettings: AppSettings;
  systemFontGateway: SystemFontGateway;
  onChangeEditorFontFamily(value: string): void;
  onChangeEditorFontLigatures(enabled: boolean): void;
  onChangeEditorFontSize(value: number): void;
  onChangeTheme(theme: AppTheme): void;
}

function AppearanceSettings({
  appSettings,
  systemFontGateway,
  onChangeEditorFontFamily,
  onChangeEditorFontLigatures,
  onChangeEditorFontSize,
  onChangeTheme,
}: AppearanceSettingsProps) {
  const [fontFamilyOptions, setFontFamilyOptions] = useState<string[]>([]);
  const fontFamilyLoadRequestRef = useRef(0);
  const visibleFontFamilyOptions = useMemo(
    () =>
      uniqueSortedStrings([
        ...fontFamilyOptions,
        appSettings.editorFontFamily,
      ]),
    [appSettings.editorFontFamily, fontFamilyOptions],
  );

  const loadInstalledFonts = useCallback(async () => {
    const requestId = fontFamilyLoadRequestRef.current + 1;
    fontFamilyLoadRequestRef.current = requestId;

    try {
      const localFamilies = await systemFontGateway.listMonospaceFontFamilies();
      if (fontFamilyLoadRequestRef.current !== requestId) {
        return;
      }
      setFontFamilyOptions(uniqueSortedStrings(localFamilies));
    } catch {
      if (fontFamilyLoadRequestRef.current !== requestId) {
        return;
      }
      setFontFamilyOptions([]);
    }
  }, [systemFontGateway]);

  useEffect(() => {
    void loadInstalledFonts();
  }, [loadInstalledFonts]);

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
          onClick={() => void loadInstalledFonts()}
          type="button"
        >
          Refresh fonts
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
