import type { IntelligenceMode } from "./workspace";

export type AppTheme = "dark" | "light" | "system";
export type PhpBackendPreference = "auto" | "phpactor" | "intelephense";
export type WorkspaceSessionBottomPanelView = "index" | "problems" | "terminal";
export type WorkspaceSessionSidebarView = "files" | "php";

export interface AppSettings {
  recentWorkspacePath: string | null;
  theme: AppTheme;
}

export interface WorkspaceSettings {
  extraIgnorePatterns: string[];
  intelligenceMode: IntelligenceMode;
  intelephensePath: string | null;
  phpBackend: PhpBackendPreference;
  phpactorPath: string | null;
  session: WorkspaceSessionState;
}

export interface WorkspaceSessionState {
  activePath: string | null;
  bottomPanelView: WorkspaceSessionBottomPanelView;
  openPaths: string[];
  sidebarView: WorkspaceSessionSidebarView;
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
    recentWorkspacePath: null,
    theme: "dark",
  };
}

export function defaultWorkspaceSettings(): WorkspaceSettings {
  return {
    extraIgnorePatterns: [],
    intelligenceMode: "basic",
    intelephensePath: null,
    phpBackend: "auto",
    phpactorPath: null,
    session: defaultWorkspaceSessionState(),
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

export function normalizeAppSettings(value: unknown): AppSettings {
  const defaults = defaultAppSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  const recentWorkspacePath = normalizeNullableString(
    value.recentWorkspacePath,
    defaults.recentWorkspacePath,
  );
  const theme = isAppTheme(value.theme) ? value.theme : defaults.theme;

  return {
    recentWorkspacePath,
    theme,
  };
}

export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  const defaults = defaultWorkspaceSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
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
    phpBackend: isPhpBackendPreference(value.phpBackend)
      ? value.phpBackend
      : defaults.phpBackend,
    phpactorPath: normalizeNullableString(
      value.phpactorPath,
      defaults.phpactorPath,
    ),
    session: normalizeWorkspaceSession(value.session),
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

export function settingsIgnorePatternsText(patterns: string[]): string {
  return patterns.join("\n");
}

export function settingsIgnorePatternsFromText(value: string): string[] {
  return normalizePatternList(value.split(/\r?\n/), []);
}

export type ResolvedAppTheme = "dark" | "light";

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
): "vs" | "vs-dark" {
  if (resolveAppTheme(theme, prefersLight) === "light") {
    return "vs";
  }

  return "vs-dark";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAppTheme(value: unknown): value is AppTheme {
  return value === "dark" || value === "light" || value === "system";
}

function isIntelligenceMode(value: unknown): value is IntelligenceMode {
  return value === "basic" || value === "lightSmart" || value === "fullSmart";
}

function isPhpBackendPreference(
  value: unknown,
): value is PhpBackendPreference {
  return value === "auto" || value === "phpactor" || value === "intelephense";
}

function isWorkspaceSessionBottomPanelView(
  value: unknown,
): value is WorkspaceSessionBottomPanelView {
  return value === "index" || value === "problems" || value === "terminal";
}

function isWorkspaceSessionSidebarView(
  value: unknown,
): value is WorkspaceSessionSidebarView {
  return value === "files" || value === "php";
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
