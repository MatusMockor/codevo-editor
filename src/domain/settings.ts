import type { IntelligenceMode } from "./workspace";
import {
  defaultKeymapSettings,
  normalizeKeymapSettings,
  type KeymapSettings,
} from "./keymap";

export const appThemeOptions = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
  { id: "ayuMirage", label: "Ayu Mirage" },
  { id: "materialDeepOcean", label: "Material Deep Ocean" },
] as const;

export type AppTheme = (typeof appThemeOptions)[number]["id"];
export type MonacoAppTheme =
  | "vs"
  | "vs-dark"
  | "mockor-calm-dark"
  | "mockor-calm-light"
  | "mockor-ayu-mirage"
  | "mockor-material-deep-ocean";
export type BackgroundRuntimePolicy =
  | "keepAlive"
  | "singleActive"
  | "suspendOnBackground";
export type JavaScriptTypeScriptServiceMode = "auto" | "off";
export type JavaScriptTypeScriptVersionPreference = "bundled" | "workspace";
export type PhpBackendPreference = "auto" | "phpactor" | "intelephense";
export type WorkspaceSessionBottomPanelView = "index" | "problems" | "terminal";
export type WorkspaceSessionSidebarView = "files" | "git" | "php";

export interface AppSettings {
  keymap: KeymapSettings;
  recentWorkspacePath: string | null;
  runtimePolicy: BackgroundRuntimePolicy;
  theme: AppTheme;
  workspaceTabs: string[];
}

export interface WorkspaceSettings {
  autoSave: boolean;
  autoSaveConfigured: boolean;
  extraIgnorePatterns: string[];
  intelligenceMode: IntelligenceMode;
  intelephensePath: string | null;
  javaScriptTypeScriptInlayHints: boolean;
  javaScriptTypeScriptService: JavaScriptTypeScriptServiceMode;
  javaScriptTypeScriptValidation: boolean;
  javaScriptTypeScriptVersion: JavaScriptTypeScriptVersionPreference;
  phpBackend: PhpBackendPreference;
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
  sidebarView: WorkspaceSessionSidebarView;
}

export interface StatusBarItemVisibility {
  activePath: boolean;
  dirtyCount: boolean;
  index: boolean;
  language: boolean;
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
    keymap: defaultKeymapSettings(),
    recentWorkspacePath: null,
    runtimePolicy: "keepAlive",
    theme: "dark",
    workspaceTabs: [],
  };
}

export function defaultWorkspaceSettings(): WorkspaceSettings {
  return {
    autoSave: true,
    autoSaveConfigured: true,
    extraIgnorePatterns: [],
    intelligenceMode: "basic",
    intelephensePath: null,
    javaScriptTypeScriptInlayHints: true,
    javaScriptTypeScriptService: "auto",
    javaScriptTypeScriptValidation: true,
    javaScriptTypeScriptVersion: "bundled",
    phpBackend: "auto",
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
    dirtyCount: true,
    index: true,
    language: true,
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
  const keymap = normalizeKeymapSettings(value.keymap);
  const runtimePolicy = isBackgroundRuntimePolicy(value.runtimePolicy)
    ? value.runtimePolicy
    : defaults.runtimePolicy;
  const theme = isAppTheme(value.theme) ? value.theme : defaults.theme;
  const workspaceTabs = normalizeWorkspaceTabs(
    value.workspaceTabs,
    recentWorkspacePath,
  );

  return {
    keymap,
    recentWorkspacePath,
    runtimePolicy,
    theme,
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
    extraIgnorePatterns: normalizePatternList(
      value.extraIgnorePatterns,
      defaults.extraIgnorePatterns,
    ),
    intelligenceMode: isIntelligenceMode(value.intelligenceMode)
      ? value.intelligenceMode
      : defaults.intelligenceMode,
    intelephensePath: normalizeNullableString(
      value.intelephensePath,
      defaults.intelephensePath,
    ),
    javaScriptTypeScriptInlayHints: normalizeBoolean(
      value.javaScriptTypeScriptInlayHints,
      defaults.javaScriptTypeScriptInlayHints,
    ),
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
    phpBackend: isPhpBackendPreference(value.phpBackend)
      ? value.phpBackend
      : defaults.phpBackend,
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

  return {
    activePath,
    bottomPanelView: isWorkspaceSessionBottomPanelView(value.bottomPanelView)
      ? value.bottomPanelView
      : defaults.bottomPanelView,
    openPaths,
    sidebarView: isWorkspaceSessionSidebarView(value.sidebarView)
      ? value.sidebarView
      : defaults.sidebarView,
  };
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
    dirtyCount: normalizeBoolean(value.dirtyCount, defaults.dirtyCount),
    index: normalizeBoolean(value.index, defaults.index),
    language: normalizeBoolean(value.language, defaults.language),
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
    return "mockor-ayu-mirage";
  }

  if (theme === "materialDeepOcean") {
    return "mockor-material-deep-ocean";
  }

  if (resolveAppTheme(theme, prefersLight) === "light") {
    return "mockor-calm-light";
  }

  return "mockor-calm-dark";
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
      black: "#8f98b3",
      blue: "#82aaff",
      brightBlack: "#c3c8d8",
      brightBlue: "#b2c8ff",
      brightCyan: "#b7ffff",
      brightGreen: "#d1ff9e",
      brightMagenta: "#f6c1ff",
      brightRed: "#ffb8c8",
      brightWhite: "#ffffff",
      brightYellow: "#ffe6a8",
      cursor: "#84ffff",
      cyan: "#89ddff",
      foreground: "#d8dee9",
      green: "#c3e88d",
      magenta: "#c792ea",
      red: "#f07178",
      selectionBackground: "#26345c",
      white: "#d8dee9",
      yellow: "#ffcb6b",
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

function isJavaScriptTypeScriptVersionPreference(
  value: unknown,
): value is JavaScriptTypeScriptVersionPreference {
  return value === "bundled" || value === "workspace";
}

function isWorkspaceSessionBottomPanelView(
  value: unknown,
): value is WorkspaceSessionBottomPanelView {
  return value === "index" || value === "problems" || value === "terminal";
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

  return Array.from(new Set(paths));
}

function normalizeWorkspaceTabs(
  value: unknown,
  recentWorkspacePath: string | null,
): string[] {
  const tabs = normalizePathList(value);

  if (!recentWorkspacePath) {
    return tabs;
  }

  if (tabs.includes(recentWorkspacePath)) {
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
