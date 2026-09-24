import {
  normalizeAgentFollowUpBehavior,
  type AgentFollowUpBehavior,
} from "./agentFollowUpBehavior";
import type { IntelligenceMode } from "./workspace";
import { defaultKeymapSettings, normalizeKeymapSettings, type KeymapSettings } from "./keymap";
import { normalizeUserSnippets, type UserSnippet } from "./snippets";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";
import { gitDirectoryMappingPaths, normalizeGitDirectoryMappings } from "./gitRepositoryMapping";
import {
  defaultLargeSmartDocumentPolicy,
  normalizeLargeSmartDocumentPolicy,
  type LargeSmartDocumentPolicy,
} from "./largeDocumentPolicy";
import { normalizeGitCommitMessageHistory } from "./gitCommitMessageHistory";
import {
  defaultAgentAppSettings,
  normalizeAgentCliKind,
  normalizeAgentCliPaths,
  normalizeAgentModelFavoritesSnapshot,
  normalizeAgentIsolationPolicy,
  normalizeAgentThreadFontSize,
  normalizeMaxConcurrentAgentTasks,
  DEFAULT_AGENT_ISOLATION_POLICY,
  type AgentCliKind,
  type AgentCliPaths,
  type AgentIsolationPolicy,
  type AgentModelFavoriteKey,
} from "./agentSettings";
import {
  normalizeAgentProviderPreferences,
  type AgentProviderPreferences,
} from "./agentProviderSettings";
import { normalizeAppUpdaterSkippedVersion } from "./appUpdater";
import {
  parseAgentWorkbenchLayout,
  parsePersistedAgentBottomPanel,
  serializeAgentWorkbenchLayout,
  type AgentWorkbenchLayoutPersisted,
} from "./agentWorkbenchLayout";
import {
  createInitialEditorGroupsState,
  normalizeEditorGroupsState,
  type EditorGroupId,
  type EditorGroupsState,
} from "./editorGroups";
import { MAX_STACK_DEPTH, type NavigationLocation } from "./navigation";
import { RECENT_FILES_LIMIT, type RecentFileEntry } from "./recentFiles";
import {
  RECENT_LOCATION_SNIPPET_MAX_BYTES,
  RECENT_LOCATIONS_LIMIT,
  type RecentLocation,
} from "./recentLocations";
import { DEFAULT_APPEARANCE, normalizeAppearance, type AppearanceSettings } from "./appearance";

export type { MonacoAppTheme, TerminalTheme } from "./editorColorThemes";

export type BackgroundRuntimePolicy = "keepAlive" | "singleActive" | "suspendOnBackground";
export type JavaScriptTypeScriptImportModuleSpecifierPreference =
  "shortest" | "relative" | "non-relative" | "project-relative";
export type JavaScriptTypeScriptImportModuleSpecifierEnding = "auto" | "minimal" | "index" | "js";
export type JavaScriptTypeScriptQuotePreference = "auto" | "single" | "double";
export type JavaScriptTypeScriptServiceMode = "auto" | "off";
export type JavaScriptTypeScriptVersionPreference = "bundled" | "workspace";
export type PhpBackendPreference = "auto" | "phpactor" | "intelephense";
export type WorkspaceSessionBottomPanelView =
  "index" | "problems" | "history" | "terminal" | "runtime" | "search";
export type WorkspaceSessionSidebarView = "files" | "git" | "php" | "scripts";
export type SettingsSection =
  | "general"
  | "keymap"
  | "php"
  | "git"
  | "index"
  | "snippets"
  | "appearance"
  | "agents"
  | "environments";

export const defaultEditorFontFamily =
  "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
export const defaultEditorFontLigatures = false;
export const defaultEditorFontSize = 14;
export const defaultWorkspaceInsertSpaces = true;
export const defaultWorkspaceTabSize = 4;
export const minEditorFontSize = 8;
export const maxEditorFontSize = 40;
export const minWorkspaceTabSize = 1;
export const maxWorkspaceTabSize = 8;
const editorFontFamilyAliases = [
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
] as const;
const editorFontFamilyAliasesByLower = new Map(
  editorFontFamilyAliases.map((fontFamily) => [fontFamily.toLowerCase(), fontFamily]),
);
const genericEditorFontFamilies = new Set([
  "cursive",
  "fantasy",
  "math",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

export interface AppSettings {
  appUpdaterSkippedVersion: string | null;
  agentCliPaths: AgentCliPaths;
  agentCliKind: AgentCliKind;
  agentFollowUpBehavior: AgentFollowUpBehavior;
  agentThreadFontSize: number;
  agentModelFavoriteKeys: ReadonlyArray<AgentModelFavoriteKey>;
  agentModelFavoritesRevision: number;
  agentProviderPreferences: AgentProviderPreferences;
  maxConcurrentAgentTasks: number;
  editorFontFamily: string;
  editorFontLigatures: boolean;
  editorFontSize: number;
  minimapEnabled?: boolean;
  keymap: KeymapSettings;
  recentWorkspacePath: string | null;
  recentWorkspacePaths?: string[];
  runtimePolicy: BackgroundRuntimePolicy;
  terminalShellIntegrationEnabled: boolean;
  appearance: AppearanceSettings;
  wordWrapEnabled?: boolean;
  /**
   * User-authored live templates, GLOBAL (app-level, not per-workspace) like
   * PhpStorm's snippets. Merged with the built-in registry at completion time.
   */
  userSnippets: UserSnippet[];
  workspaceTabs: string[];
}

export interface WorkspaceSettings {
  agentIsolationPolicy: AgentIsolationPolicy;
  autoSave: boolean;
  autoSaveConfigured: boolean;
  defaultInsertSpaces: boolean;
  defaultTabSize: number;
  extraIgnorePatterns: string[];
  eslintAnalyseOnSave: boolean;
  eslintFixOnSave: boolean;
  eslintPath: string | null;
  formatOnPaste: boolean;
  formatOnSave: boolean;
  gitCommitMessageHistory: string[];
  /**
   * Git directory mappings (PhpStorm-style), each a repository directory
   * relative to the workspace root; `""` is the workspace root itself (main
   * repo). Empty means only the workspace root repo is tracked. See
   * {@link normalizeGitDirectoryMappings} for the shape and safety rules.
   */
  gitDirectoryMappings: string[];
  /**
   * When true, nested repositories are auto-detected on workspace open. A user
   * who edits the list switches to a manual override by turning this off.
   */
  gitDirectoryMappingsAuto: boolean;
  intelligenceMode: IntelligenceMode;
  intelephensePath: string | null;
  javaScriptTypeScriptAutoImports: boolean;
  javaScriptTypeScriptAutomaticTypeAcquisition: boolean;
  javaScriptTypeScriptAddMissingImportsOnSave: boolean;
  javaScriptTypeScriptCodeLens: boolean;
  javaScriptTypeScriptReferencesCodeLensOnAllFunctions: boolean;
  javaScriptTypeScriptCompleteFunctionCalls: boolean;
  javaScriptTypeScriptFixAllOnSave: boolean;
  javaScriptTypeScriptImportModuleSpecifierEnding: JavaScriptTypeScriptImportModuleSpecifierEnding;
  javaScriptTypeScriptImportModuleSpecifierPreference: JavaScriptTypeScriptImportModuleSpecifierPreference;
  javaScriptTypeScriptInlayHints: boolean;
  javaScriptTypeScriptOrganizeImportsOnSave: boolean;
  javaScriptTypeScriptPreferTypeOnlyAutoImports: boolean;
  javaScriptTypeScriptQuotePreference: JavaScriptTypeScriptQuotePreference;
  javaScriptTypeScriptRemoveUnusedOnSave: boolean;
  javaScriptTypeScriptService: JavaScriptTypeScriptServiceMode;
  javaScriptTypeScriptValidation: boolean;
  javaScriptTypeScriptVersion: JavaScriptTypeScriptVersionPreference;
  largeFileMode: LargeSmartDocumentPolicy;
  /**
   * Reorganizes PHP `use` imports (drops unused, sorts) right before a PHP file
   * is written on save. Off by default, mirroring PhpStorm's opt-in "Optimize
   * imports on the fly / on save".
   */
  optimizeImportsOnSave: boolean;
  phpBackend: PhpBackendPreference;
  phpInlayHints: boolean;
  phpstanAnalyseOnSave: boolean;
  phpstanPath: string | null;
  phpVersionOverride: string | null;
  phpactorPath: string | null;
  prettierFormatOnSave: boolean;
  revealActiveFileInTree: boolean;
  session: WorkspaceSessionState;
  statusBar: StatusBarItemVisibility;
}

export const WORKSPACE_SESSION_VERSION = 1 as const;
export const DEFAULT_WORKSPACE_EDITOR_GROUP_ID = "editor-main";
export const WORKSPACE_SESSION_NAVIGATION_MAX_BYTES = 128 * 1_024;
export const WORKSPACE_SESSION_PATH_MAX_BYTES = 4 * 1_024;
export const WORKSPACE_SESSION_NAME_MAX_BYTES = 512;
export const WORKSPACE_SESSION_SNIPPET_MAX_BYTES = RECENT_LOCATION_SNIPPET_MAX_BYTES;
export const WORKSPACE_SESSION_POSITION_MAX = 10_000_000;
export const MAX_RECENT_WORKSPACE_PATHS = 25;

export interface WorkspaceSessionNavigation {
  backStack: NavigationLocation[];
  forwardStack: NavigationLocation[];
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
}

export interface WorkspaceSessionStateV1 {
  agentWorkbench?: AgentWorkbenchLayoutPersisted;
  bottomPanelView: WorkspaceSessionBottomPanelView;
  editor: EditorGroupsState;
  navigation?: WorkspaceSessionNavigation;
  sidebarView: WorkspaceSessionSidebarView;
  version: typeof WORKSPACE_SESSION_VERSION;
  viewStates?: Record<EditorGroupId, Record<string, WorkspaceSessionViewState>>;
}

export type WorkspaceSessionState = WorkspaceSessionStateV1;

export interface WorkspaceSessionViewState {
  column: number;
  foldedLines?: number[];
  line: number;
  scrollTop?: number;
}

type WorkspaceSessionGroupViewStates = NonNullable<WorkspaceSessionState["viewStates"]>;

export interface StatusBarItemVisibility {
  activePath: boolean;
  agentAttention: boolean;
  cursorPosition: boolean;
  dirtyCount: boolean;
  gitBranch: boolean;
  index: boolean;
  language: boolean;
  largeFileMode: boolean;
  languageServer: boolean;
  message: boolean;
  mode: boolean;
  workspaceInfo: boolean;
  workspaceTrust: boolean;
}

export interface SettingsGateway {
  loadAppSettings(): Promise<AppSettings>;
  readInitialAppearance?(): AppearanceSettings;
  saveAppSettings(settings: AppSettings): Promise<void>;
  loadWorkspaceSettings(identity: string | WorkspaceSettingsIdentity): Promise<WorkspaceSettings>;
  saveWorkspaceSettings(
    identity: string | WorkspaceSettingsIdentity,
    settings: WorkspaceSettings,
  ): Promise<void>;
}

export interface WorkspaceSettingsIdentity {
  canonicalKey: string;
  /** Ordered migration candidates: canonical direct path before selected alias. */
  legacyRawKeys?: readonly string[];
}

export function defaultAppSettings(): AppSettings {
  return {
    ...defaultAgentAppSettings(),
    appUpdaterSkippedVersion: null,
    editorFontFamily: defaultEditorFontFamily,
    editorFontLigatures: defaultEditorFontLigatures,
    editorFontSize: defaultEditorFontSize,
    minimapEnabled: false,
    keymap: defaultKeymapSettings(),
    recentWorkspacePath: null,
    recentWorkspacePaths: [],
    runtimePolicy: "keepAlive",
    terminalShellIntegrationEnabled: false,
    appearance: DEFAULT_APPEARANCE,
    wordWrapEnabled: false,
    userSnippets: [],
    workspaceTabs: [],
  };
}

export function normalizeEditorFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultEditorFontSize;
  }

  const rounded = Math.floor(value);

  return Math.min(Math.max(rounded, minEditorFontSize), maxEditorFontSize);
}

export function normalizeWorkspaceTabSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultWorkspaceTabSize;
  }

  const rounded = Math.floor(value);

  return Math.min(Math.max(rounded, minWorkspaceTabSize), maxWorkspaceTabSize);
}

export function normalizeEditorFontFamily(value: unknown): string {
  if (typeof value !== "string") {
    return defaultEditorFontFamily;
  }

  const normalizedFamilies = value
    .split(",")
    .map((fontFamily) => fontFamily.trim())
    .filter(Boolean)
    .map(
      (fontFamily) => editorFontFamilyAliasesByLower.get(fontFamily.toLowerCase()) ?? fontFamily,
    );

  if (normalizedFamilies.length === 0) {
    return defaultEditorFontFamily;
  }

  if (
    normalizedFamilies.length === 1 &&
    !genericEditorFontFamilies.has(normalizedFamilies[0].toLowerCase())
  ) {
    return `${normalizedFamilies[0]}, monospace`;
  }

  return normalizedFamilies.join(", ");
}

export function monacoFontLigaturesForEditorSetting(enabled: boolean): string {
  return enabled ? '"liga" on, "calt" on' : '"liga" off, "calt" off';
}

export function defaultWorkspaceSettings(): WorkspaceSettings {
  return {
    agentIsolationPolicy: DEFAULT_AGENT_ISOLATION_POLICY,
    autoSave: true,
    autoSaveConfigured: true,
    defaultInsertSpaces: defaultWorkspaceInsertSpaces,
    defaultTabSize: defaultWorkspaceTabSize,
    extraIgnorePatterns: [],
    eslintAnalyseOnSave: false,
    eslintFixOnSave: false,
    eslintPath: null,
    formatOnPaste: false,
    formatOnSave: false,
    gitCommitMessageHistory: [],
    gitDirectoryMappings: [],
    gitDirectoryMappingsAuto: true,
    intelligenceMode: "basic",
    intelephensePath: null,
    javaScriptTypeScriptAddMissingImportsOnSave: false,
    javaScriptTypeScriptAutoImports: true,
    javaScriptTypeScriptAutomaticTypeAcquisition: false,
    javaScriptTypeScriptCodeLens: false,
    javaScriptTypeScriptReferencesCodeLensOnAllFunctions: false,
    javaScriptTypeScriptCompleteFunctionCalls: false,
    javaScriptTypeScriptFixAllOnSave: false,
    javaScriptTypeScriptImportModuleSpecifierEnding: "auto",
    javaScriptTypeScriptImportModuleSpecifierPreference: "shortest",
    javaScriptTypeScriptInlayHints: true,
    javaScriptTypeScriptOrganizeImportsOnSave: false,
    javaScriptTypeScriptPreferTypeOnlyAutoImports: false,
    javaScriptTypeScriptQuotePreference: "auto",
    javaScriptTypeScriptRemoveUnusedOnSave: false,
    javaScriptTypeScriptService: "auto",
    javaScriptTypeScriptValidation: true,
    javaScriptTypeScriptVersion: "bundled",
    largeFileMode: { ...defaultLargeSmartDocumentPolicy },
    optimizeImportsOnSave: false,
    phpBackend: "auto",
    phpInlayHints: true,
    phpstanAnalyseOnSave: false,
    phpstanPath: null,
    phpVersionOverride: null,
    phpactorPath: null,
    prettierFormatOnSave: false,
    revealActiveFileInTree: true,
    session: defaultWorkspaceSessionState(),
    statusBar: defaultStatusBarItemVisibility(),
  };
}

export function defaultWorkspaceSessionState(): WorkspaceSessionState {
  return {
    bottomPanelView: "problems",
    editor: createInitialEditorGroupsState(DEFAULT_WORKSPACE_EDITOR_GROUP_ID),
    sidebarView: "files",
    version: WORKSPACE_SESSION_VERSION,
  };
}

export function defaultStatusBarItemVisibility(): StatusBarItemVisibility {
  return {
    activePath: true,
    agentAttention: true,
    cursorPosition: true,
    dirtyCount: true,
    gitBranch: true,
    index: true,
    language: true,
    largeFileMode: true,
    languageServer: true,
    message: true,
    mode: true,
    workspaceInfo: true,
    workspaceTrust: true,
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const defaults = defaultAppSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  const legacyRecentWorkspacePath = normalizeNullableString(
    value.recentWorkspacePath,
    defaults.recentWorkspacePath,
  );
  const recentWorkspacePaths = Array.isArray(value.recentWorkspacePaths)
    ? normalizeRecentWorkspacePaths(value.recentWorkspacePaths)
    : pushRecentWorkspacePath([], legacyRecentWorkspacePath ?? "");
  const recentWorkspacePath = recentWorkspacePaths[0] ?? null;
  const editorFontSize =
    value.editorFontSize === undefined
      ? defaults.editorFontSize
      : normalizeEditorFontSize(value.editorFontSize);
  const editorFontFamily =
    value.editorFontFamily === undefined
      ? defaults.editorFontFamily
      : normalizeEditorFontFamily(value.editorFontFamily);
  const editorFontLigatures = normalizeBoolean(
    value.editorFontLigatures,
    defaults.editorFontLigatures,
  );
  const keymap = normalizeKeymapSettings(value.keymap);
  const minimapEnabled = normalizeBoolean(value.minimapEnabled, false);
  const runtimePolicy = isBackgroundRuntimePolicy(value.runtimePolicy)
    ? value.runtimePolicy
    : defaults.runtimePolicy;
  const terminalShellIntegrationEnabled = normalizeBoolean(
    value.terminalShellIntegrationEnabled,
    defaults.terminalShellIntegrationEnabled,
  );
  const wordWrapEnabled = normalizeBoolean(value.wordWrapEnabled, false);
  const userSnippets = normalizeUserSnippets(value.userSnippets);
  const workspaceTabs = normalizeWorkspaceTabs(value.workspaceTabs, recentWorkspacePath);
  const agentCliKind = normalizeAgentCliKind(value.agentCliKind);
  const agentCliPaths = normalizeAgentCliPaths(
    value.agentCliPaths,
    value.agentCliPath,
    agentCliKind,
  );
  const agentModelFavorites = normalizeAgentModelFavoritesSnapshot(
    value.agentModelFavoriteKeys,
    value.agentModelFavoritesRevision,
  );

  return {
    appUpdaterSkippedVersion: normalizeAppUpdaterSkippedVersion(value.appUpdaterSkippedVersion),
    agentCliPaths,
    agentCliKind,
    agentFollowUpBehavior: normalizeAgentFollowUpBehavior(value.agentFollowUpBehavior),
    agentThreadFontSize:
      value.agentThreadFontSize === undefined
        ? defaults.agentThreadFontSize
        : normalizeAgentThreadFontSize(value.agentThreadFontSize),
    agentModelFavoriteKeys: agentModelFavorites.keys,
    agentModelFavoritesRevision: agentModelFavorites.revision,
    agentProviderPreferences: normalizeAgentProviderPreferences(value.agentProviderPreferences),
    maxConcurrentAgentTasks: normalizeMaxConcurrentAgentTasks(value.maxConcurrentAgentTasks),
    editorFontFamily,
    editorFontLigatures,
    editorFontSize,
    keymap,
    minimapEnabled,
    recentWorkspacePath,
    recentWorkspacePaths,
    runtimePolicy,
    terminalShellIntegrationEnabled,
    appearance: normalizeAppearance(value.appearance, value.theme),
    wordWrapEnabled,
    userSnippets,
    workspaceTabs,
  };
}

function isNavigationRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return !Object.keys(value).some(
    (key) => key === "__proto__" || key === "constructor" || key === "prototype",
  );
}

export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  const defaults = defaultWorkspaceSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    agentIsolationPolicy: normalizeAgentIsolationPolicy(value.agentIsolationPolicy),
    autoSave:
      value.autoSaveConfigured === true && typeof value.autoSave === "boolean"
        ? value.autoSave
        : defaults.autoSave,
    autoSaveConfigured: true,
    defaultInsertSpaces: normalizeBoolean(value.defaultInsertSpaces, defaults.defaultInsertSpaces),
    defaultTabSize:
      value.defaultTabSize === undefined
        ? defaults.defaultTabSize
        : normalizeWorkspaceTabSize(value.defaultTabSize),
    extraIgnorePatterns: normalizePatternList(
      value.extraIgnorePatterns,
      defaults.extraIgnorePatterns,
    ),
    eslintAnalyseOnSave: normalizeBoolean(value.eslintAnalyseOnSave, defaults.eslintAnalyseOnSave),
    eslintFixOnSave: normalizeBoolean(value.eslintFixOnSave, defaults.eslintFixOnSave),
    eslintPath: normalizeNullableString(value.eslintPath, defaults.eslintPath),
    formatOnPaste: normalizeBoolean(value.formatOnPaste, defaults.formatOnPaste),
    formatOnSave: normalizeBoolean(value.formatOnSave, defaults.formatOnSave),
    gitCommitMessageHistory: normalizeGitCommitMessageHistory(value.gitCommitMessageHistory),
    gitDirectoryMappings: gitDirectoryMappingPaths(
      normalizeGitDirectoryMappings(value.gitDirectoryMappings),
    ),
    gitDirectoryMappingsAuto: normalizeBoolean(
      value.gitDirectoryMappingsAuto,
      defaults.gitDirectoryMappingsAuto,
    ),
    intelligenceMode: isIntelligenceMode(value.intelligenceMode)
      ? value.intelligenceMode
      : defaults.intelligenceMode,
    intelephensePath: normalizeNullableString(value.intelephensePath, defaults.intelephensePath),
    javaScriptTypeScriptAutoImports: normalizeBoolean(
      value.javaScriptTypeScriptAutoImports,
      defaults.javaScriptTypeScriptAutoImports,
    ),
    javaScriptTypeScriptAutomaticTypeAcquisition: normalizeBoolean(
      value.javaScriptTypeScriptAutomaticTypeAcquisition,
      defaults.javaScriptTypeScriptAutomaticTypeAcquisition,
    ),
    javaScriptTypeScriptAddMissingImportsOnSave: normalizeBoolean(
      value.javaScriptTypeScriptAddMissingImportsOnSave,
      defaults.javaScriptTypeScriptAddMissingImportsOnSave,
    ),
    javaScriptTypeScriptCodeLens: normalizeBoolean(
      value.javaScriptTypeScriptCodeLens,
      defaults.javaScriptTypeScriptCodeLens,
    ),
    javaScriptTypeScriptReferencesCodeLensOnAllFunctions: normalizeBoolean(
      value.javaScriptTypeScriptReferencesCodeLensOnAllFunctions,
      defaults.javaScriptTypeScriptReferencesCodeLensOnAllFunctions,
    ),
    javaScriptTypeScriptCompleteFunctionCalls: normalizeBoolean(
      value.javaScriptTypeScriptCompleteFunctionCalls,
      defaults.javaScriptTypeScriptCompleteFunctionCalls,
    ),
    javaScriptTypeScriptFixAllOnSave: normalizeBoolean(
      value.javaScriptTypeScriptFixAllOnSave,
      defaults.javaScriptTypeScriptFixAllOnSave,
    ),
    javaScriptTypeScriptImportModuleSpecifierEnding:
      isJavaScriptTypeScriptImportModuleSpecifierEnding(
        value.javaScriptTypeScriptImportModuleSpecifierEnding,
      )
        ? value.javaScriptTypeScriptImportModuleSpecifierEnding
        : defaults.javaScriptTypeScriptImportModuleSpecifierEnding,
    javaScriptTypeScriptImportModuleSpecifierPreference:
      isJavaScriptTypeScriptImportModuleSpecifierPreference(
        value.javaScriptTypeScriptImportModuleSpecifierPreference,
      )
        ? value.javaScriptTypeScriptImportModuleSpecifierPreference
        : defaults.javaScriptTypeScriptImportModuleSpecifierPreference,
    javaScriptTypeScriptInlayHints: normalizeBoolean(
      value.javaScriptTypeScriptInlayHints,
      defaults.javaScriptTypeScriptInlayHints,
    ),
    javaScriptTypeScriptOrganizeImportsOnSave: normalizeBoolean(
      value.javaScriptTypeScriptOrganizeImportsOnSave,
      defaults.javaScriptTypeScriptOrganizeImportsOnSave,
    ),
    javaScriptTypeScriptRemoveUnusedOnSave: normalizeBoolean(
      value.javaScriptTypeScriptRemoveUnusedOnSave,
      defaults.javaScriptTypeScriptRemoveUnusedOnSave,
    ),
    javaScriptTypeScriptPreferTypeOnlyAutoImports: normalizeBoolean(
      value.javaScriptTypeScriptPreferTypeOnlyAutoImports,
      defaults.javaScriptTypeScriptPreferTypeOnlyAutoImports,
    ),
    javaScriptTypeScriptQuotePreference: isJavaScriptTypeScriptQuotePreference(
      value.javaScriptTypeScriptQuotePreference,
    )
      ? value.javaScriptTypeScriptQuotePreference
      : defaults.javaScriptTypeScriptQuotePreference,
    javaScriptTypeScriptService: isJavaScriptTypeScriptServiceMode(
      value.javaScriptTypeScriptService,
    )
      ? value.javaScriptTypeScriptService
      : defaults.javaScriptTypeScriptService,
    javaScriptTypeScriptValidation: normalizeBoolean(
      value.javaScriptTypeScriptValidation,
      defaults.javaScriptTypeScriptValidation,
    ),
    javaScriptTypeScriptVersion: isJavaScriptTypeScriptVersionPreference(
      value.javaScriptTypeScriptVersion,
    )
      ? value.javaScriptTypeScriptVersion
      : defaults.javaScriptTypeScriptVersion,
    largeFileMode: normalizeLargeSmartDocumentPolicy(value.largeFileMode, defaults.largeFileMode),
    optimizeImportsOnSave: normalizeBoolean(
      value.optimizeImportsOnSave,
      defaults.optimizeImportsOnSave,
    ),
    phpBackend: isPhpBackendPreference(value.phpBackend) ? value.phpBackend : defaults.phpBackend,
    phpInlayHints: normalizeBoolean(value.phpInlayHints, defaults.phpInlayHints),
    phpstanAnalyseOnSave: normalizeBoolean(
      value.phpstanAnalyseOnSave,
      defaults.phpstanAnalyseOnSave,
    ),
    phpstanPath: normalizeNullableString(value.phpstanPath, defaults.phpstanPath),
    phpVersionOverride: normalizeNullableString(
      value.phpVersionOverride,
      defaults.phpVersionOverride,
    ),
    phpactorPath: normalizeNullableString(value.phpactorPath, defaults.phpactorPath),
    prettierFormatOnSave: normalizeBoolean(
      value.prettierFormatOnSave,
      defaults.prettierFormatOnSave,
    ),
    revealActiveFileInTree:
      typeof value.revealActiveFileInTree === "boolean"
        ? value.revealActiveFileInTree
        : defaults.revealActiveFileInTree,
    session: normalizeWorkspaceSession(value.session),
    statusBar: normalizeStatusBarItemVisibility(value.statusBar),
  };
}

export function normalizeWorkspaceSession(value: unknown): WorkspaceSessionState {
  const defaults = defaultWorkspaceSessionState();

  if (!isRecord(value)) {
    return defaults;
  }

  if (value.version !== undefined && value.version !== WORKSPACE_SESSION_VERSION) {
    return defaults;
  }

  const editor =
    value.version === WORKSPACE_SESSION_VERSION
      ? normalizeEditorGroupsState(value.editor, DEFAULT_WORKSPACE_EDITOR_GROUP_ID)
      : migrateLegacyWorkspaceSessionEditor(value);
  const viewStates =
    value.version === WORKSPACE_SESSION_VERSION
      ? normalizeWorkspaceSessionGroupViewStates(value.viewStates, editor)
      : normalizeLegacyWorkspaceSessionViewStates(value.viewStates, editor);
  const navigation = normalizeWorkspaceSessionNavigation(value.navigation);
  const agentWorkbench = normalizeWorkspaceSessionAgentWorkbench(value.agentWorkbench);

  const normalized: WorkspaceSessionState = {
    bottomPanelView: isWorkspaceSessionBottomPanelView(value.bottomPanelView)
      ? value.bottomPanelView
      : defaults.bottomPanelView,
    editor,
    sidebarView: isWorkspaceSessionSidebarView(value.sidebarView)
      ? value.sidebarView
      : defaults.sidebarView,
    version: WORKSPACE_SESSION_VERSION,
  };

  if (agentWorkbench) {
    normalized.agentWorkbench = agentWorkbench;
  }

  if (navigation) {
    normalized.navigation = navigation;
  }

  if (Object.keys(viewStates).length > 0) {
    normalized.viewStates = viewStates;
  }

  return normalized;
}

export function normalizeWorkspaceSessionAgentWorkbench(
  value: unknown,
): AgentWorkbenchLayoutPersisted | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    return undefined;
  }

  return serializeAgentWorkbenchLayout(
    parseAgentWorkbenchLayout(value),
    parsePersistedAgentBottomPanel(value),
  );
}

export function normalizeWorkspaceSessionNavigation(
  value: unknown,
): WorkspaceSessionNavigation | undefined {
  if (!isNavigationRecord(value)) {
    return undefined;
  }

  const normalized: WorkspaceSessionNavigation = {
    backStack: normalizeNavigationLocations(arrayValue(value.backStack), MAX_STACK_DEPTH),
    forwardStack: normalizeNavigationLocations(arrayValue(value.forwardStack), MAX_STACK_DEPTH),
    recentFiles: normalizeRecentFiles(arrayValue(value.recentFiles), RECENT_FILES_LIMIT),
    recentLocations: normalizeRecentLocations(
      arrayValue(value.recentLocations),
      RECENT_LOCATIONS_LIMIT,
    ),
  };

  let byteLength = jsonByteLength(normalized);
  while (byteLength > WORKSPACE_SESSION_NAVIGATION_MAX_BYTES) {
    if (normalized.forwardStack.length > 0) {
      byteLength -= removedJsonArrayEntryBytes(normalized.forwardStack);
      continue;
    }

    if (normalized.backStack.length > 0) {
      byteLength -= removedJsonArrayEntryBytes(normalized.backStack, "head");
      continue;
    }

    if (normalized.recentLocations.length > 0) {
      byteLength -= removedJsonArrayEntryBytes(normalized.recentLocations);
      continue;
    }

    if (normalized.recentFiles.length > 0) {
      byteLength -= removedJsonArrayEntryBytes(normalized.recentFiles);
      continue;
    }

    break;
  }

  return normalized;
}

function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value;
}

function normalizeNavigationLocations(value: unknown[], limit: number): NavigationLocation[] {
  const normalized: NavigationLocation[] = [];

  for (const entry of value.slice(0, limit)) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["path", "position"])) {
      continue;
    }

    if (
      !isBoundedString(entry.path, WORKSPACE_SESSION_PATH_MAX_BYTES, false) ||
      !isRecord(entry.position) ||
      !hasOnlyKeys(entry.position, ["column", "lineNumber"]) ||
      !isBoundedPosition(entry.position.column) ||
      !isBoundedPosition(entry.position.lineNumber)
    ) {
      continue;
    }

    normalized.push({
      path: entry.path,
      position: {
        column: entry.position.column,
        lineNumber: entry.position.lineNumber,
      },
    });
  }

  return normalized;
}

function normalizeRecentFiles(value: unknown[], limit: number): RecentFileEntry[] {
  const normalized: RecentFileEntry[] = [];

  for (const entry of value.slice(0, limit)) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["name", "path"]) ||
      !isBoundedString(entry.name, WORKSPACE_SESSION_NAME_MAX_BYTES, false) ||
      !isBoundedString(entry.path, WORKSPACE_SESSION_PATH_MAX_BYTES, false)
    ) {
      continue;
    }

    normalized.push({ name: entry.name, path: entry.path });
  }

  return normalized;
}

function normalizeRecentLocations(value: unknown[], limit: number): RecentLocation[] {
  const normalized: RecentLocation[] = [];

  for (const entry of value.slice(0, limit)) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["column", "line", "name", "path", "relativePath", "snippet"]) ||
      !isBoundedPosition(entry.column) ||
      !isBoundedPosition(entry.line) ||
      !isBoundedString(entry.name, WORKSPACE_SESSION_NAME_MAX_BYTES, false) ||
      !isBoundedString(entry.path, WORKSPACE_SESSION_PATH_MAX_BYTES, false) ||
      !isBoundedString(entry.relativePath, WORKSPACE_SESSION_PATH_MAX_BYTES, false) ||
      typeof entry.snippet !== "string"
    ) {
      continue;
    }

    normalized.push({
      column: entry.column,
      line: entry.line,
      name: entry.name,
      path: entry.path,
      relativePath: entry.relativePath,
      snippet: truncateUtf8(entry.snippet, WORKSPACE_SESSION_SNIPPET_MAX_BYTES),
    });
  }

  return normalized;
}

const textEncoder = new TextEncoder();

export function truncateWorkspaceSessionSnippet(value: string): string {
  return truncateUtf8(value, WORKSPACE_SESSION_SNIPPET_MAX_BYTES);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (value.length <= maxBytes && textEncoder.encode(value).byteLength <= maxBytes) {
    return value;
  }

  const candidate = value.slice(0, maxBytes);
  const bytes = new Uint8Array(maxBytes);
  const { read } = textEncoder.encodeInto(candidate, bytes);
  return candidate.slice(0, read);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedString(value: unknown, maxBytes: number, allowEmpty: boolean): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (!allowEmpty && value.length === 0) {
    return false;
  }

  if (value.length > maxBytes) {
    return false;
  }

  return textEncoder.encode(value).byteLength <= maxBytes;
}

function isBoundedPosition(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    typeof value === "number" &&
    value > 0 &&
    value <= WORKSPACE_SESSION_POSITION_MAX
  );
}

function jsonByteLength(value: unknown): number {
  try {
    return textEncoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function removedJsonArrayEntryBytes<T>(entries: T[], end: "head" | "tail" = "tail"): number {
  const previousLength = entries.length;
  const removed = end === "head" ? entries.shift() : entries.pop();
  if (removed === undefined) {
    return 0;
  }

  return textEncoder.encode(JSON.stringify(removed)).byteLength + (previousLength > 1 ? 1 : 0);
}

function migrateLegacyWorkspaceSessionEditor(value: Record<string, unknown>): EditorGroupsState {
  const openPaths = normalizePathList(value.openPaths);
  const previewPath = normalizeSessionPreviewPath(value.previewPath, openPaths);
  const pinnedPaths = previewPath ? openPaths.filter((path) => path !== previewPath) : openPaths;
  const visiblePaths = previewPath ? [...pinnedPaths, previewPath] : pinnedPaths;
  const activePath = normalizeSessionActivePath(value.activePath, visiblePaths);

  return createInitialEditorGroupsState(DEFAULT_WORKSPACE_EDITOR_GROUP_ID, {
    activePath,
    openPaths: pinnedPaths,
    previewPath,
  });
}

function normalizeLegacyWorkspaceSessionViewStates(
  value: unknown,
  editor: EditorGroupsState,
): WorkspaceSessionGroupViewStates {
  const group = editor.groups[DEFAULT_WORKSPACE_EDITOR_GROUP_ID];
  const visiblePaths = group.previewPath
    ? [...group.openPaths, group.previewPath]
    : group.openPaths;
  const normalized = normalizeWorkspaceSessionViewStates(value, visiblePaths);

  return Object.keys(normalized).length > 0
    ? { [DEFAULT_WORKSPACE_EDITOR_GROUP_ID]: normalized }
    : {};
}

function normalizeWorkspaceSessionGroupViewStates(
  value: unknown,
  editor: EditorGroupsState,
): WorkspaceSessionGroupViewStates {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(editor.groups).flatMap(([groupId, group]) => {
      const visiblePaths = group.previewPath
        ? [...group.openPaths, group.previewPath]
        : group.openPaths;
      const normalized = normalizeWorkspaceSessionViewStates(value[groupId], visiblePaths);

      return Object.keys(normalized).length > 0 ? [[groupId, normalized]] : [];
    }),
  );
}

export function normalizeStatusBarItemVisibility(value: unknown): StatusBarItemVisibility {
  const defaults = defaultStatusBarItemVisibility();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    activePath: normalizeBoolean(value.activePath, defaults.activePath),
    agentAttention: normalizeBoolean(value.agentAttention, defaults.agentAttention),
    cursorPosition: normalizeBoolean(value.cursorPosition, defaults.cursorPosition),
    dirtyCount: normalizeBoolean(value.dirtyCount, defaults.dirtyCount),
    gitBranch: normalizeBoolean(value.gitBranch, defaults.gitBranch),
    index: normalizeBoolean(value.index, defaults.index),
    language: normalizeBoolean(value.language, defaults.language),
    largeFileMode: normalizeBoolean(value.largeFileMode, defaults.largeFileMode),
    languageServer: normalizeBoolean(value.languageServer, defaults.languageServer),
    message: normalizeBoolean(value.message, defaults.message),
    mode: normalizeBoolean(value.mode, defaults.mode),
    workspaceInfo: normalizeBoolean(value.workspaceInfo, defaults.workspaceInfo),
    workspaceTrust: normalizeBoolean(value.workspaceTrust, defaults.workspaceTrust),
  };
}

export function settingsIgnorePatternsText(patterns: string[]): string {
  return patterns.join("\n");
}

export function settingsIgnorePatternsFromText(value: string): string[] {
  return normalizePatternList(value.split(/\r?\n/), []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBackgroundRuntimePolicy(value: unknown): value is BackgroundRuntimePolicy {
  return value === "keepAlive" || value === "singleActive" || value === "suspendOnBackground";
}

function isIntelligenceMode(value: unknown): value is IntelligenceMode {
  return value === "basic" || value === "lightSmart" || value === "fullSmart";
}

function isPhpBackendPreference(value: unknown): value is PhpBackendPreference {
  return value === "auto" || value === "phpactor" || value === "intelephense";
}

function isJavaScriptTypeScriptServiceMode(
  value: unknown,
): value is JavaScriptTypeScriptServiceMode {
  return value === "auto" || value === "off";
}

function isJavaScriptTypeScriptImportModuleSpecifierPreference(
  value: unknown,
): value is JavaScriptTypeScriptImportModuleSpecifierPreference {
  return (
    value === "shortest" ||
    value === "relative" ||
    value === "non-relative" ||
    value === "project-relative"
  );
}

function isJavaScriptTypeScriptImportModuleSpecifierEnding(
  value: unknown,
): value is JavaScriptTypeScriptImportModuleSpecifierEnding {
  return value === "auto" || value === "minimal" || value === "index" || value === "js";
}

function isJavaScriptTypeScriptQuotePreference(
  value: unknown,
): value is JavaScriptTypeScriptQuotePreference {
  return value === "auto" || value === "single" || value === "double";
}

function isJavaScriptTypeScriptVersionPreference(
  value: unknown,
): value is JavaScriptTypeScriptVersionPreference {
  return value === "bundled" || value === "workspace";
}

function isWorkspaceSessionBottomPanelView(
  value: unknown,
): value is WorkspaceSessionBottomPanelView {
  return (
    value === "index" ||
    value === "problems" ||
    value === "history" ||
    value === "terminal" ||
    value === "runtime" ||
    value === "search"
  );
}

function isWorkspaceSessionSidebarView(value: unknown): value is WorkspaceSessionSidebarView {
  return value === "files" || value === "git" || value === "php" || value === "scripts";
}

function normalizeNullableString(value: unknown, fallback: string | null): string | null {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePatternList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const patterns = value
    .filter((pattern): pattern is string => typeof pattern === "string")
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  return Array.from(new Set(patterns));
}

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const paths = value
    .filter((path): path is string => typeof path === "string")
    .map((path) => path.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const path of paths) {
    const key = normalizedWorkspaceRootKey(path);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(path);
  }

  return normalized;
}

export function normalizeRecentWorkspacePaths(value: unknown): string[] {
  return normalizePathList(value).slice(0, MAX_RECENT_WORKSPACE_PATHS);
}

export function pushRecentWorkspacePath(currentPaths: unknown, path: string): string[] {
  const normalizedPath = path.trim();
  const current = normalizeRecentWorkspacePaths(currentPaths);

  if (!normalizedPath) {
    return current;
  }

  const key = normalizedWorkspaceRootKey(normalizedPath);
  const remaining = current.filter(
    (currentPath) => normalizedWorkspaceRootKey(currentPath) !== key,
  );

  return [normalizedPath, ...remaining].slice(0, MAX_RECENT_WORKSPACE_PATHS);
}

function normalizeWorkspaceTabs(value: unknown, recentWorkspacePath: string | null): string[] {
  const tabs = normalizePathList(value);

  if (!recentWorkspacePath) {
    return tabs;
  }

  if (
    tabs.some(
      (path) =>
        normalizedWorkspaceRootKey(path) === normalizedWorkspaceRootKey(recentWorkspacePath),
    )
  ) {
    return tabs;
  }

  return [...tabs, recentWorkspacePath];
}

function normalizeSessionActivePath(value: unknown, openPaths: string[]): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const activePath = value.trim();

  if (!openPaths.includes(activePath)) {
    return null;
  }

  return activePath;
}

function normalizeSessionPreviewPath(value: unknown, openPaths: string[]): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const previewPath = value.trim();

  if (!openPaths.includes(previewPath)) {
    return null;
  }

  return previewPath;
}

function normalizeWorkspaceSessionViewStates(
  value: unknown,
  openPaths: string[],
): Record<string, WorkspaceSessionViewState> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, WorkspaceSessionViewState> = {};

  for (const path of openPaths) {
    const viewState = value[path];

    if (!isRecord(viewState)) {
      continue;
    }

    if (!isPositiveInteger(viewState.line)) {
      continue;
    }

    if (!isPositiveInteger(viewState.column)) {
      continue;
    }

    if (
      viewState.scrollTop !== undefined &&
      (!isFiniteNumber(viewState.scrollTop) || viewState.scrollTop < 0)
    ) {
      continue;
    }

    const foldedLines = Array.isArray(viewState.foldedLines)
      ? [...new Set(viewState.foldedLines.filter(isPositiveInteger))]
          .sort((left, right) => left - right)
          .slice(0, 500)
      : [];

    normalized[path] = {
      column: viewState.column,
      ...(foldedLines.length === 0 ? {} : { foldedLines }),
      line: viewState.line,
      ...(viewState.scrollTop === undefined ? {} : { scrollTop: viewState.scrollTop }),
    };
  }

  return normalized;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
