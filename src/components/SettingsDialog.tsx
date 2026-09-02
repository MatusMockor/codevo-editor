import { Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppUpdaterSurface } from "../application/useAppUpdater";
import { normalizeShortcutInput } from "../domain/keymap";
import {
  normalizeEditorFontFamily,
  normalizeEditorFontSize,
  settingsIgnorePatternsFromText,
  settingsIgnorePatternsText,
  type AppSettings,
  type BackgroundRuntimePolicy,
  type JavaScriptTypeScriptImportModuleSpecifierEnding,
  type JavaScriptTypeScriptImportModuleSpecifierPreference,
  type JavaScriptTypeScriptQuotePreference,
  type JavaScriptTypeScriptServiceMode,
  type JavaScriptTypeScriptVersionPreference,
  type SettingsSection,
  type StatusBarItemVisibility,
  type WorkspaceSettings,
} from "../domain/settings";
import {
  gitDirectoryMappingPaths,
  normalizeGitDirectoryMappings,
} from "../domain/gitRepositoryMapping";
import type { SystemFontGateway } from "../domain/systemFonts";
import type { IntelligenceMode } from "../domain/workspace";
import { settingsDialogSections } from "./settingsDialogModel";
import { AgentSettingsDialogSection } from "./AgentSettingsDialogSection";
import { AppearanceSettings } from "./AppearanceSettingsSection";
import { IndexSettings } from "./IndexSettingsSection";
import { GeneralAppUpdateSettings } from "./GeneralAppUpdateSettings";
import { KeymapSettingsPanel } from "./KeymapSettingsPanel";
import { PhpSettings } from "./PhpSettingsSection";
import { SnippetsSettings } from "./SnippetsSettingsSection";
import { settingsDialogDraftPersistence } from "./settingsDialogDraftPersistence";
import type { SettingsDialogProps } from "./settingsDialogTypes";
import { nullableInputValue } from "./settingsDialogValues";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { settingsSectionLabel } from "./settingsSectionPresentation";

export type { SettingsSaveInput } from "./settingsDialogTypes";

const emptySystemFontGateway: SystemFontGateway = {
  listMonospaceFontFamilies: async () => [],
};

export function SettingsDialog({
  appUpdater = null,
  appSettings,
  gitDetectedRepositoryMappings = [],
  initialSection = "general",
  isOpen,
  onClose,
  onOpenJavaScriptTypeScriptServiceLog,
  onOpenNodeLaunchConfigurations = () => undefined,
  onRestartJavaScriptTypeScriptService,
  onSave,
  phpTools,
  systemFontGateway = emptySystemFontGateway,
  workspaceDescriptor,
  workspaceRoot,
  workspaceSettings,
  workspaceTrust,
  ...agentProviderControls
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [draftAppSettings, setDraftAppSettings] = useState<AppSettings>(appSettings);
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
    setIgnorePatternsText(settingsIgnorePatternsText(workspaceSettings.extraIgnorePatterns));
  }, [appSettings, initialSection, isOpen, workspaceSettings, workspaceTrust]);

  useEffect(() => {
    if (isOpen) {
      setActiveSection(initialSection);
    }
  }, [initialSection, isOpen]);

  const selectedSectionLabel = settingsSectionLabel(activeSection);

  if (!isOpen) {
    return null;
  }

  const {
    save: saveDraft,
    updateAppSettings,
    updateTrusted,
    updateWorkspaceSettings,
  } = settingsDialogDraftPersistence({
    appSettingsRef: draftAppSettingsRef,
    hasWorkspace,
    onSave,
    setAppSettings: setDraftAppSettings,
    setTrusted: setDraftTrusted,
    setWorkspaceSettings: setDraftWorkspaceSettings,
    trustedRef: draftTrustedRef,
    workspaceSettingsRef: draftWorkspaceSettingsRef,
  });

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
              {settingsDialogSections.map((section) => (
                <button
                  aria-selected={activeSection === section.id}
                  className={
                    activeSection === section.id ? "settings-nav-item active" : "settings-nav-item"
                  }
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  type="button"
                >
                  {section.label}
                </button>
              ))}
            </nav>

            <div aria-label={selectedSectionLabel} className="settings-section" role="tabpanel">
              <SettingsSectionHeader label={selectedSectionLabel} />
              {activeSection === "general" ? (
                <GeneralSettings
                  appUpdater={appUpdater}
                  appSettings={draftAppSettings}
                  draftTrusted={draftTrusted}
                  hasWorkspace={hasWorkspace}
                  onChangeRuntimePolicy={(runtimePolicy) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      runtimePolicy,
                    })
                  }
                  onChangeTerminalShellIntegrationEnabled={(terminalShellIntegrationEnabled) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      terminalShellIntegrationEnabled,
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
                  onChangeEslintPath={(eslintPath) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      eslintPath: nullableInputValue(eslintPath),
                    })
                  }
                  onChangeEslintAnalyseOnSave={(eslintAnalyseOnSave) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      eslintAnalyseOnSave,
                    })
                  }
                  onChangeEslintFixOnSave={(eslintFixOnSave) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      eslintFixOnSave,
                    })
                  }
                  onChangePrettierFormatOnSave={(prettierFormatOnSave) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      prettierFormatOnSave,
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
                  onChangeJavaScriptTypeScriptService={(javaScriptTypeScriptService) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptService,
                    })
                  }
                  onChangeJavaScriptTypeScriptAutoImports={(javaScriptTypeScriptAutoImports) =>
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
                  onChangeJavaScriptTypeScriptCodeLens={(javaScriptTypeScriptCodeLens) =>
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
                  onChangeJavaScriptTypeScriptInlayHints={(javaScriptTypeScriptInlayHints) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptInlayHints,
                    })
                  }
                  onChangeJavaScriptTypeScriptFixAllOnSave={(javaScriptTypeScriptFixAllOnSave) =>
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
                  onChangeJavaScriptTypeScriptValidation={(javaScriptTypeScriptValidation) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      javaScriptTypeScriptValidation,
                    })
                  }
                  onChangeJavaScriptTypeScriptVersion={(javaScriptTypeScriptVersion) =>
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
                  onRestartJavaScriptTypeScriptService={onRestartJavaScriptTypeScriptService}
                  onOpenJavaScriptTypeScriptServiceLog={onOpenJavaScriptTypeScriptServiceLog}
                  onOpenNodeLaunchConfigurations={onOpenNodeLaunchConfigurations}
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
                  onChangePhpstanAnalyseOnSave={(phpstanAnalyseOnSave) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      phpstanAnalyseOnSave,
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
                  gitDirectoryMappings={draftWorkspaceSettings.gitDirectoryMappings}
                  gitDirectoryMappingsAuto={draftWorkspaceSettings.gitDirectoryMappingsAuto}
                  hasWorkspace={hasWorkspace}
                  onChangeGitDirectoryMappings={(gitDirectoryMappings) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      gitDirectoryMappings,
                    })
                  }
                  onChangeGitDirectoryMappingsAuto={(gitDirectoryMappingsAuto) =>
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
                  largeFileMode={draftWorkspaceSettings.largeFileMode}
                  onChangeLargeFileModeCharacterLimit={(characterLimit) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      largeFileMode: {
                        ...draftWorkspaceSettingsRef.current.largeFileMode,
                        characterLimit,
                      },
                    })
                  }
                  onChangeLargeFileModeLineLimit={(lineLimit) =>
                    updateWorkspaceSettings({
                      ...draftWorkspaceSettingsRef.current,
                      largeFileMode: {
                        ...draftWorkspaceSettingsRef.current.largeFileMode,
                        lineLimit,
                      },
                    })
                  }
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

              {activeSection === "agents" ? (
                <AgentSettingsDialogSection
                  appSettings={draftAppSettings}
                  appSettingsRef={draftAppSettingsRef}
                  hasWorkspace={hasWorkspace}
                  onPersistAppSettings={(settings) => saveDraft({ appSettings: settings })}
                  onPublishAppSettings={(settings) => {
                    draftAppSettingsRef.current = settings;
                    setDraftAppSettings(settings);
                  }}
                  onUpdateWorkspaceSettings={updateWorkspaceSettings}
                  {...agentProviderControls}
                  workspaceSettings={draftWorkspaceSettings}
                />
              ) : null}

              {activeSection === "appearance" ? (
                <AppearanceSettings
                  appSettings={draftAppSettings}
                  systemFontGateway={systemFontGateway}
                  onChangeEditorFontFamily={(editorFontFamily) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      editorFontFamily: normalizeEditorFontFamily(editorFontFamily),
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
                  onChangeMinimapEnabled={(minimapEnabled) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      minimapEnabled,
                    })
                  }
                  onChangeWordWrapEnabled={(wordWrapEnabled) =>
                    updateAppSettings({
                      ...draftAppSettingsRef.current,
                      wordWrapEnabled,
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
  appUpdater: AppUpdaterSurface | null;
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
  onChangeEslintAnalyseOnSave(enabled: boolean): void;
  onChangeEslintFixOnSave(enabled: boolean): void;
  onChangeEslintPath(path: string): void;
  onChangeOptimizeImportsOnSave(optimizeImportsOnSave: boolean): void;
  onChangePrettierFormatOnSave(enabled: boolean): void;
  onChangeIntelligenceMode(mode: IntelligenceMode): void;
  onChangeJavaScriptTypeScriptService(mode: JavaScriptTypeScriptServiceMode): void;
  onChangeJavaScriptTypeScriptAutoImports(enabled: boolean): void;
  onChangeJavaScriptTypeScriptAutomaticTypeAcquisition(enabled: boolean): void;
  onChangeJavaScriptTypeScriptAddMissingImportsOnSave(enabled: boolean): void;
  onChangeJavaScriptTypeScriptCodeLens(enabled: boolean): void;
  onChangeJavaScriptTypeScriptReferencesCodeLensOnAllFunctions(enabled: boolean): void;
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
  onChangeJavaScriptTypeScriptVersion(preference: JavaScriptTypeScriptVersionPreference): void;
  onChangeRevealActiveFileInTree(enabled: boolean): void;
  onChangeRuntimePolicy(policy: BackgroundRuntimePolicy): void;
  onChangeTerminalShellIntegrationEnabled(enabled: boolean): void;
  onChangeStatusBarVisibility(key: keyof StatusBarItemVisibility, visible: boolean): void;
  onChangeTrusted(trusted: boolean): void;
  onOpenJavaScriptTypeScriptServiceLog(): Promise<void>;
  onOpenNodeLaunchConfigurations(): void;
  onRestartJavaScriptTypeScriptService(): Promise<void>;
}

function GeneralSettings({
  appUpdater,
  appSettings,
  draftTrusted,
  hasWorkspace,
  onChangeAutoSave,
  onChangeDefaultInsertSpaces,
  onChangeDefaultTabSize,
  onChangeFormatOnPaste,
  onChangeFormatOnSave,
  onChangeEslintAnalyseOnSave,
  onChangeEslintFixOnSave,
  onChangeEslintPath,
  onChangeOptimizeImportsOnSave,
  onChangePrettierFormatOnSave,
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
  onChangeTerminalShellIntegrationEnabled,
  onChangeStatusBarVisibility,
  onChangeTrusted,
  onOpenJavaScriptTypeScriptServiceLog,
  onOpenNodeLaunchConfigurations,
  onRestartJavaScriptTypeScriptService,
  workspaceRoot,
  workspaceSettings,
}: GeneralSettingsProps) {
  return (
    <div className="settings-group settings-group--general">
      {appUpdater ? <GeneralAppUpdateSettings updater={appUpdater} /> : null}
      <label className="settings-field">
        <span>Workspace</span>
        <input readOnly value={workspaceRoot || "No workspace open"} />
      </label>

      <label className="settings-field">
        <span>Mode</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeIntelligenceMode(event.currentTarget.value as IntelligenceMode)
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
        <span>ESLint path</span>
        <input
          disabled={!hasWorkspace}
          onChange={(event) => onChangeEslintPath(event.currentTarget.value)}
          placeholder="node_modules/.bin/eslint / Auto"
          value={workspaceSettings.eslintPath || ""}
        />
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.eslintAnalyseOnSave}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeEslintAnalyseOnSave(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>ESLint analyse on save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.eslintFixOnSave}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeEslintFixOnSave(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>ESLint fix on save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.prettierFormatOnSave}
          disabled={!hasWorkspace}
          onChange={(event) => onChangePrettierFormatOnSave(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Prettier format on save</span>
      </label>

      <label className="settings-field">
        <span>TypeScript version</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptVersion(
              event.currentTarget.value as JavaScriptTypeScriptVersionPreference,
            )
          }
          value={workspaceSettings.javaScriptTypeScriptVersion}
        >
          <option value="bundled">Managed</option>
          <option value="workspace">Workspace</option>
        </select>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptValidation}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeJavaScriptTypeScriptValidation(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>JavaScript/TypeScript validation</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptAutoImports}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeJavaScriptTypeScriptAutoImports(event.currentTarget.checked)}
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
              event.currentTarget.value as JavaScriptTypeScriptImportModuleSpecifierPreference,
            )
          }
          value={workspaceSettings.javaScriptTypeScriptImportModuleSpecifierPreference}
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
              event.currentTarget.value as JavaScriptTypeScriptImportModuleSpecifierEnding,
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
            onChangeJavaScriptTypeScriptPreferTypeOnlyAutoImports(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>JS/TS prefer type-only auto imports</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptAutomaticTypeAcquisition}
          disabled={!hasWorkspace}
          onChange={(event) =>
            onChangeJavaScriptTypeScriptAutomaticTypeAcquisition(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>JavaScript/TypeScript automatic type acquisition</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptInlayHints}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeJavaScriptTypeScriptInlayHints(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>JavaScript/TypeScript inlay hints</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptCodeLens}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeJavaScriptTypeScriptCodeLens(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>JavaScript/TypeScript CodeLens</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.javaScriptTypeScriptReferencesCodeLensOnAllFunctions}
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
            onChangeJavaScriptTypeScriptCompleteFunctionCalls(event.currentTarget.checked)
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
            onChangeJavaScriptTypeScriptOrganizeImportsOnSave(event.currentTarget.checked)
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
            onChangeJavaScriptTypeScriptRemoveUnusedOnSave(event.currentTarget.checked)
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
            onChangeJavaScriptTypeScriptAddMissingImportsOnSave(event.currentTarget.checked)
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
            onChangeJavaScriptTypeScriptFixAllOnSave(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>JS/TS fix all on save</span>
      </label>

      <div className="settings-actions">
        <button disabled={!hasWorkspace} onClick={onOpenNodeLaunchConfigurations} type="button">
          Edit Node launch configurations
        </button>
        <button
          disabled={!hasWorkspace || workspaceSettings.javaScriptTypeScriptService === "off"}
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
            onChangeRuntimePolicy(event.currentTarget.value as BackgroundRuntimePolicy)
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
          checked={appSettings.terminalShellIntegrationEnabled}
          onChange={(event) => onChangeTerminalShellIntegrationEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Terminal shell integration</span>
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
          onChange={(event) => onChangeOptimizeImportsOnSave(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Optimize imports on save</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.formatOnPaste}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeFormatOnPaste(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Format on Paste</span>
      </label>

      <label className="settings-field">
        <span>Default tab size</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) => onChangeDefaultTabSize(Number(event.currentTarget.value))}
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
          onChange={(event) => onChangeDefaultInsertSpaces(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Insert spaces by default</span>
      </label>

      <label className="settings-toggle">
        <input
          checked={workspaceSettings.revealActiveFileInTree}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeRevealActiveFileInTree(event.currentTarget.checked)}
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
                onChangeStatusBarVisibility(item.key, event.currentTarget.checked)
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
  const manualByKey = new Set(gitDirectoryMappings.map((path) => path.toLowerCase()));
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
    onChangeGitDirectoryMappings(gitDirectoryMappings.filter((mapping) => mapping !== path));
  };

  return (
    <div className="settings-group">
      <p className="settings-hint">
        Route git operations per directory: a workspace can hold a main repository at its root plus
        nested package repositories (for example <code>workbench/lcsk/*</code>). Each file commits
        and pushes into the repository that owns it.
      </p>

      <label className="settings-toggle">
        <input
          checked={gitDirectoryMappingsAuto}
          disabled={!hasWorkspace}
          onChange={(event) => onChangeGitDirectoryMappingsAuto(event.currentTarget.checked)}
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
