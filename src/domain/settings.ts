import type { IntelligenceMode } from "./workspace";
import {
  defaultKeymapSettings,
  normalizeKeymapSettings,
  type KeymapSettings,
} from "./keymap";
import { normalizeUserSnippets, type UserSnippet } from "./snippets";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";
import {
  gitDirectoryMappingPaths,
  normalizeGitDirectoryMappings,
} from "./gitRepositoryMapping";
import {
  defaultLargeSmartDocumentPolicy,
  normalizeLargeSmartDocumentPolicy,
  type LargeSmartDocumentPolicy,
} from "./largeDocumentPolicy";
import { normalizeGitCommitMessageHistory } from "./gitCommitMessageHistory";

export const appThemeOptions = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
  { id: "ayuMirage", label: "Ayu Mirage" },
  { id: "materialDeepOcean", label: "Material Deep Ocean" },
  { id: "oneDarkPro", label: "One Dark Pro" },
  { id: "dracula", label: "Dracula" },
  { id: "catppuccinMocha", label: "Catppuccin Mocha" },
  { id: "catppuccinLatte", label: "Catppuccin Latte" },
  { id: "oneLight", label: "One Light" },
  { id: "darkPlus", label: "Dark Plus (VS Code)" },
] as const;

export type AppTheme = (typeof appThemeOptions)[number]["id"];
export type MonacoAppTheme =
  | "calm-dark"
  | "calm-light"
  | "ayu-mirage"
  | "material-deep-ocean"
  | "one-dark-pro"
  | "dracula"
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "one-light"
  | "dark-plus";
export type BackgroundRuntimePolicy =
  | "keepAlive"
  | "singleActive"
  | "suspendOnBackground";
export type JavaScriptTypeScriptImportModuleSpecifierPreference =
  | "shortest"
  | "relative"
  | "non-relative"
  | "project-relative";
export type JavaScriptTypeScriptImportModuleSpecifierEnding =
  | "auto"
  | "minimal"
  | "index"
  | "js";
export type JavaScriptTypeScriptQuotePreference = "auto" | "single" | "double";
export type JavaScriptTypeScriptServiceMode = "auto" | "off";
export type JavaScriptTypeScriptVersionPreference = "bundled" | "workspace";
export type PhpBackendPreference = "auto" | "phpactor" | "intelephense";
export type WorkspaceSessionBottomPanelView =
  | "index"
  | "problems"
  | "history"
  | "terminal"
  | "runtime";
export type WorkspaceSessionSidebarView = "files" | "git" | "php";
export type SettingsSection =
  | "general"
  | "keymap"
  | "php"
  | "git"
  | "index"
  | "snippets"
  | "appearance";

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
  editorFontFamilyAliases.map((fontFamily) => [
    fontFamily.toLowerCase(),
    fontFamily,
  ]),
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
  editorFontFamily: string;
  editorFontLigatures: boolean;
  editorFontSize: number;
  keymap: KeymapSettings;
  recentWorkspacePath: string | null;
  runtimePolicy: BackgroundRuntimePolicy;
  theme: AppTheme;
  /**
   * User-authored live templates, GLOBAL (app-level, not per-workspace) like
   * PhpStorm's snippets. Merged with the built-in registry at completion time.
   */
  userSnippets: UserSnippet[];
  workspaceTabs: string[];
}

export interface WorkspaceSettings {
  autoSave: boolean;
  autoSaveConfigured: boolean;
  defaultInsertSpaces: boolean;
  defaultTabSize: number;
  extraIgnorePatterns: string[];
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
  phpVersionOverride: string | null;
  phpactorPath: string | null;
  revealActiveFileInTree: boolean;
  session: WorkspaceSessionState;
  statusBar: StatusBarItemVisibility;
}

export interface WorkspaceSessionState {
  activePath: string | null;
  bottomPanelView: WorkspaceSessionBottomPanelView;
  openPaths: string[];
  previewPath?: string | null;
  sidebarView: WorkspaceSessionSidebarView;
  viewStates?: Record<string, WorkspaceSessionViewState>;
}

export interface WorkspaceSessionViewState {
  column: number;
  foldedLines?: number[];
  line: number;
  scrollTop?: number;
}

export interface StatusBarItemVisibility {
  activePath: boolean;
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
  saveAppSettings(settings: AppSettings): Promise<void>;
  loadWorkspaceSettings(rootPath: string): Promise<WorkspaceSettings>;
  saveWorkspaceSettings(
    rootPath: string,
    settings: WorkspaceSettings,
  ): Promise<void>;
}

export function defaultAppSettings(): AppSettings {
  return {
    editorFontFamily: defaultEditorFontFamily,
    editorFontLigatures: defaultEditorFontLigatures,
    editorFontSize: defaultEditorFontSize,
    keymap: defaultKeymapSettings(),
    recentWorkspacePath: null,
    runtimePolicy: "keepAlive",
    theme: "dark",
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

  return Math.min(
    Math.max(rounded, minWorkspaceTabSize),
    maxWorkspaceTabSize,
  );
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
      (fontFamily) =>
        editorFontFamilyAliasesByLower.get(fontFamily.toLowerCase()) ??
        fontFamily,
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
    autoSave: true,
    autoSaveConfigured: true,
    defaultInsertSpaces: defaultWorkspaceInsertSpaces,
    defaultTabSize: defaultWorkspaceTabSize,
    extraIgnorePatterns: [],
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
    phpVersionOverride: null,
    phpactorPath: null,
    revealActiveFileInTree: true,
    session: defaultWorkspaceSessionState(),
    statusBar: defaultStatusBarItemVisibility(),
  };
}

export function defaultWorkspaceSessionState(): WorkspaceSessionState {
  return {
    activePath: null,
    bottomPanelView: "problems",
    openPaths: [],
    sidebarView: "files",
  };
}

export function defaultStatusBarItemVisibility(): StatusBarItemVisibility {
  return {
    activePath: true,
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

  const recentWorkspacePath = normalizeNullableString(
    value.recentWorkspacePath,
    defaults.recentWorkspacePath,
  );
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
  const runtimePolicy = isBackgroundRuntimePolicy(value.runtimePolicy)
    ? value.runtimePolicy
    : defaults.runtimePolicy;
  const theme = isAppTheme(value.theme) ? value.theme : defaults.theme;
  const userSnippets = normalizeUserSnippets(value.userSnippets);
  const workspaceTabs = normalizeWorkspaceTabs(
    value.workspaceTabs,
    recentWorkspacePath,
  );

  return {
    editorFontFamily,
    editorFontLigatures,
    editorFontSize,
    keymap,
    recentWorkspacePath,
    runtimePolicy,
    theme,
    userSnippets,
    workspaceTabs,
  };
}

export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  const defaults = defaultWorkspaceSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    autoSave:
      value.autoSaveConfigured === true && typeof value.autoSave === "boolean"
        ? value.autoSave
        : defaults.autoSave,
    autoSaveConfigured: true,
    defaultInsertSpaces: normalizeBoolean(
      value.defaultInsertSpaces,
      defaults.defaultInsertSpaces,
    ),
    defaultTabSize:
      value.defaultTabSize === undefined
        ? defaults.defaultTabSize
        : normalizeWorkspaceTabSize(value.defaultTabSize),
    extraIgnorePatterns: normalizePatternList(
      value.extraIgnorePatterns,
      defaults.extraIgnorePatterns,
    ),
    formatOnPaste: normalizeBoolean(
      value.formatOnPaste,
      defaults.formatOnPaste,
    ),
    formatOnSave: normalizeBoolean(value.formatOnSave, defaults.formatOnSave),
    gitCommitMessageHistory: normalizeGitCommitMessageHistory(
      value.gitCommitMessageHistory,
    ),
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
    intelephensePath: normalizeNullableString(
      value.intelephensePath,
      defaults.intelephensePath,
    ),
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
    javaScriptTypeScriptQuotePreference:
      isJavaScriptTypeScriptQuotePreference(
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
    largeFileMode: normalizeLargeSmartDocumentPolicy(
      value.largeFileMode,
      defaults.largeFileMode,
    ),
    optimizeImportsOnSave: normalizeBoolean(
      value.optimizeImportsOnSave,
      defaults.optimizeImportsOnSave,
    ),
    phpBackend: isPhpBackendPreference(value.phpBackend)
      ? value.phpBackend
      : defaults.phpBackend,
    phpInlayHints: normalizeBoolean(
      value.phpInlayHints,
      defaults.phpInlayHints,
    ),
    phpVersionOverride: normalizeNullableString(
      value.phpVersionOverride,
      defaults.phpVersionOverride,
    ),
    phpactorPath: normalizeNullableString(
      value.phpactorPath,
      defaults.phpactorPath,
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

  const openPaths = normalizePathList(value.openPaths);
  const activePath = normalizeSessionActivePath(value.activePath, openPaths);
  const previewPath = normalizeSessionPreviewPath(value.previewPath, openPaths);
  const viewStates = normalizeWorkspaceSessionViewStates(
    value.viewStates,
    openPaths,
  );

  const normalized: WorkspaceSessionState = {
    activePath,
    bottomPanelView: isWorkspaceSessionBottomPanelView(value.bottomPanelView)
      ? value.bottomPanelView
      : defaults.bottomPanelView,
    openPaths,
    sidebarView: isWorkspaceSessionSidebarView(value.sidebarView)
      ? value.sidebarView
      : defaults.sidebarView,
  };

  if (previewPath) {
    normalized.previewPath = previewPath;
  }

  if (Object.keys(viewStates).length > 0) {
    normalized.viewStates = viewStates;
  }

  return normalized;
}

export function normalizeStatusBarItemVisibility(
  value: unknown,
): StatusBarItemVisibility {
  const defaults = defaultStatusBarItemVisibility();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    activePath: normalizeBoolean(value.activePath, defaults.activePath),
    cursorPosition: normalizeBoolean(
      value.cursorPosition,
      defaults.cursorPosition,
    ),
    dirtyCount: normalizeBoolean(value.dirtyCount, defaults.dirtyCount),
    gitBranch: normalizeBoolean(value.gitBranch, defaults.gitBranch),
    index: normalizeBoolean(value.index, defaults.index),
    language: normalizeBoolean(value.language, defaults.language),
    largeFileMode: normalizeBoolean(
      value.largeFileMode,
      defaults.largeFileMode,
    ),
    languageServer: normalizeBoolean(
      value.languageServer,
      defaults.languageServer,
    ),
    message: normalizeBoolean(value.message, defaults.message),
    mode: normalizeBoolean(value.mode, defaults.mode),
    workspaceInfo: normalizeBoolean(
      value.workspaceInfo,
      defaults.workspaceInfo,
    ),
    workspaceTrust: normalizeBoolean(
      value.workspaceTrust,
      defaults.workspaceTrust,
    ),
  };
}

export function settingsIgnorePatternsText(patterns: string[]): string {
  return patterns.join("\n");
}

export function settingsIgnorePatternsFromText(value: string): string[] {
  return normalizePatternList(value.split(/\r?\n/), []);
}

export type ResolvedAppTheme = "dark" | "light";

export interface TerminalTheme {
  background: string;
  black: string;
  blue: string;
  brightBlack: string;
  brightBlue: string;
  brightCyan: string;
  brightGreen: string;
  brightMagenta: string;
  brightRed: string;
  brightWhite: string;
  brightYellow: string;
  cursor: string;
  cyan: string;
  foreground: string;
  green: string;
  magenta: string;
  red: string;
  selectionBackground: string;
  white: string;
  yellow: string;
}

export function resolveAppTheme(
  theme: AppTheme,
  prefersLight: boolean,
): ResolvedAppTheme {
  if (theme === "light") {
    return "light";
  }

  if (theme === "system" && prefersLight) {
    return "light";
  }

  return "dark";
}

export function monacoThemeForAppTheme(
  theme: AppTheme,
  prefersLight = false,
): MonacoAppTheme {
  if (theme === "ayuMirage") {
    return "ayu-mirage";
  }

  if (theme === "materialDeepOcean") {
    return "material-deep-ocean";
  }

  if (theme === "oneDarkPro") {
    return "one-dark-pro";
  }

  if (theme === "dracula") {
    return "dracula";
  }

  if (theme === "catppuccinMocha") {
    return "catppuccin-mocha";
  }

  if (theme === "catppuccinLatte") {
    return "catppuccin-latte";
  }

  if (theme === "oneLight") {
    return "one-light";
  }

  if (theme === "darkPlus") {
    return "dark-plus";
  }

  if (resolveAppTheme(theme, prefersLight) === "light") {
    return "calm-light";
  }

  return "calm-dark";
}

export function terminalThemeForAppTheme(
  theme: AppTheme,
  prefersLight = false,
): TerminalTheme {
  if (theme === "ayuMirage") {
    return {
      background: "#1f2430",
      black: "#9aa5b7",
      blue: "#73d0ff",
      brightBlack: "#c0cad8",
      brightBlue: "#9fdcff",
      brightCyan: "#b8f4e6",
      brightGreen: "#d5ff80",
      brightMagenta: "#ffb8f0",
      brightRed: "#ffc0b8",
      brightWhite: "#f8f4e3",
      brightYellow: "#ffe6a3",
      cursor: "#ffcc66",
      cyan: "#95e6cb",
      foreground: "#cbccc6",
      green: "#bae67e",
      magenta: "#d4bfff",
      red: "#f28779",
      selectionBackground: "#33415e",
      white: "#d9dee8",
      yellow: "#ffd580",
    };
  }

  if (theme === "materialDeepOcean") {
    return {
      background: "#0f111a",
      black: "#8a90b5",
      blue: "#82aaff",
      brightBlack: "#b4b9d4",
      brightBlue: "#9fc1ff",
      brightCyan: "#a3f7f7",
      brightGreen: "#d3f59a",
      brightMagenta: "#e2b6ff",
      brightRed: "#ff9aa0",
      brightWhite: "#ffffff",
      brightYellow: "#ffe0a3",
      cursor: "#84ffff",
      cyan: "#89ddff",
      foreground: "#a6accd",
      green: "#c3e88d",
      magenta: "#c792ea",
      red: "#f07178",
      selectionBackground: "#1f2233",
      white: "#d7dbe8",
      yellow: "#ffcb6b",
    };
  }

  if (theme === "oneDarkPro") {
    return {
      background: "#282c34",
      black: "#969cab",
      blue: "#61afef",
      brightBlack: "#abb2bf",
      brightBlue: "#8fc4f5",
      brightCyan: "#7fd4de",
      brightGreen: "#b6e09a",
      brightMagenta: "#dba6e8",
      brightRed: "#f4929a",
      brightWhite: "#ffffff",
      brightYellow: "#f0d29a",
      cursor: "#61afef",
      cyan: "#56b6c2",
      foreground: "#abb2bf",
      green: "#98c379",
      magenta: "#c678dd",
      red: "#e88a91",
      selectionBackground: "#3e4451",
      white: "#cdd3de",
      yellow: "#e5c07b",
    };
  }

  if (theme === "dracula") {
    return {
      background: "#282a36",
      black: "#8b93b8",
      blue: "#bd93f9",
      brightBlack: "#b3bbe0",
      brightBlue: "#d6b8ff",
      brightCyan: "#a4ffff",
      brightGreen: "#74ffa0",
      brightMagenta: "#ff92e0",
      brightRed: "#ff8080",
      brightWhite: "#ffffff",
      brightYellow: "#ffffa5",
      cursor: "#f8f8f2",
      cyan: "#8be9fd",
      foreground: "#f8f8f2",
      green: "#50fa7b",
      magenta: "#ff79c6",
      red: "#ff5555",
      selectionBackground: "#44475a",
      white: "#e8e8e3",
      yellow: "#f1fa8c",
    };
  }

  if (theme === "catppuccinMocha") {
    return {
      background: "#1e1e2e",
      black: "#9399b2",
      blue: "#89b4fa",
      brightBlack: "#a6adc8",
      brightBlue: "#a6c8ff",
      brightCyan: "#a0eaf0",
      brightGreen: "#c2f0bd",
      brightMagenta: "#f0abdc",
      brightRed: "#f8aec2",
      brightWhite: "#ffffff",
      brightYellow: "#fceec6",
      cursor: "#f5e0dc",
      cyan: "#94e2d5",
      foreground: "#cdd6f4",
      green: "#a6e3a1",
      magenta: "#f5c2e7",
      red: "#f38ba8",
      selectionBackground: "#363a4f",
      white: "#dce0f0",
      yellow: "#f9e2af",
    };
  }

  if (theme === "catppuccinLatte") {
    return {
      background: "#eff1f5",
      black: "#4c4f69",
      blue: "#1e5fd6",
      brightBlack: "#383a4f",
      brightBlue: "#1a52c0",
      brightCyan: "#0a6270",
      brightGreen: "#266b1b",
      brightMagenta: "#8c1a9b",
      brightRed: "#b00d2f",
      brightWhite: "#45485c",
      brightYellow: "#7a5200",
      cursor: "#dc8a78",
      cyan: "#0a7080",
      foreground: "#4c4f69",
      green: "#2e7d20",
      magenta: "#a01fb0",
      red: "#d20f39",
      selectionBackground: "#bcc0cc",
      white: "#5c5f77",
      yellow: "#8a5e00",
    };
  }

  if (theme === "oneLight") {
    return {
      background: "#fafafa",
      black: "#383a42",
      blue: "#274fb0",
      brightBlack: "#2b2d34",
      brightBlue: "#1f4499",
      brightCyan: "#0a5f6c",
      brightGreen: "#2a6029",
      brightMagenta: "#841d92",
      brightRed: "#b32a1e",
      brightWhite: "#1c1d22",
      brightYellow: "#6a4f00",
      cursor: "#526fff",
      cyan: "#0a6e7a",
      foreground: "#383a42",
      green: "#2f6b2e",
      magenta: "#9020a0",
      red: "#c4331f",
      selectionBackground: "#cfcfcf",
      white: "#4f525e",
      yellow: "#7a5800",
    };
  }

  if (theme === "darkPlus") {
    return {
      background: "#1e1e1e",
      black: "#000000",
      blue: "#2472c8",
      brightBlack: "#666666",
      brightBlue: "#3b8eea",
      brightCyan: "#29b8db",
      brightGreen: "#23d18b",
      brightMagenta: "#d670d6",
      brightRed: "#f14c4c",
      brightWhite: "#e5e5e5",
      brightYellow: "#f5f543",
      cursor: "#ffffff",
      cyan: "#11a8cd",
      foreground: "#cccccc",
      green: "#0dbc79",
      magenta: "#bc3fbc",
      red: "#cd3131",
      selectionBackground: "#264f78",
      white: "#e5e5e5",
      yellow: "#e5e510",
    };
  }

  if (resolveAppTheme(theme, prefersLight) === "light") {
    return {
      background: "#f4f6f8",
      black: "#18212b",
      blue: "#2563eb",
      brightBlack: "#526173",
      brightBlue: "#2563eb",
      brightCyan: "#0f766e",
      brightGreen: "#15803d",
      brightMagenta: "#9333ea",
      brightRed: "#b91c1c",
      brightWhite: "#18212b",
      brightYellow: "#b45309",
      cursor: "#263240",
      cyan: "#0f766e",
      foreground: "#263240",
      green: "#15803d",
      magenta: "#7e22ce",
      red: "#b91c1c",
      selectionBackground: "#d5e8e5",
      white: "#526173",
      yellow: "#a16207",
    };
  }

  return {
    background: "#111418",
    black: "#7f8b9a",
    blue: "#7aa2f7",
    brightBlack: "#aeb7c3",
    brightBlue: "#9bbcff",
    brightCyan: "#9ed0c5",
    brightGreen: "#a7d08c",
    brightMagenta: "#d6a5dd",
    brightRed: "#f2a6a6",
    brightWhite: "#f3f6f8",
    brightYellow: "#e6c27a",
    cursor: "#d8dee9",
    cyan: "#7dc5bc",
    foreground: "#d8dee9",
    green: "#8fcb7f",
    magenta: "#c49ad4",
    red: "#e58b8b",
    selectionBackground: "#33414f",
    white: "#d8dee9",
    yellow: "#d7b56d",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAppTheme(value: unknown): value is AppTheme {
  return appThemeOptions.some((option) => option.id === value);
}

function isBackgroundRuntimePolicy(
  value: unknown,
): value is BackgroundRuntimePolicy {
  return (
    value === "keepAlive" ||
    value === "singleActive" ||
    value === "suspendOnBackground"
  );
}

function isIntelligenceMode(value: unknown): value is IntelligenceMode {
  return value === "basic" || value === "lightSmart" || value === "fullSmart";
}

function isPhpBackendPreference(
  value: unknown,
): value is PhpBackendPreference {
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
  return (
    value === "auto" ||
    value === "minimal" ||
    value === "index" ||
    value === "js"
  );
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
    value === "runtime"
  );
}

function isWorkspaceSessionSidebarView(
  value: unknown,
): value is WorkspaceSessionSidebarView {
  return value === "files" || value === "git" || value === "php";
}

function normalizeNullableString(
  value: unknown,
  fallback: string | null,
): string | null {
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

function normalizePatternList(
  value: unknown,
  fallback: string[],
): string[] {
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

function normalizeWorkspaceTabs(
  value: unknown,
  recentWorkspacePath: string | null,
): string[] {
  const tabs = normalizePathList(value);

  if (!recentWorkspacePath) {
    return tabs;
  }

  if (
    tabs.some(
      (path) =>
        normalizedWorkspaceRootKey(path) ===
        normalizedWorkspaceRootKey(recentWorkspacePath),
    )
  ) {
    return tabs;
  }

  return [...tabs, recentWorkspacePath];
}

function normalizeSessionActivePath(
  value: unknown,
  openPaths: string[],
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const activePath = value.trim();

  if (!openPaths.includes(activePath)) {
    return null;
  }

  return activePath;
}

function normalizeSessionPreviewPath(
  value: unknown,
  openPaths: string[],
): string | null {
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
      ...(viewState.scrollTop === undefined
        ? {}
        : { scrollTop: viewState.scrollTop }),
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
