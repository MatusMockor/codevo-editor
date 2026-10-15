import {
  normalizeAgentFollowUpBehavior,
  type AgentFollowUpBehavior,
} from "./agentFollowUpBehavior";
import { defaultKeymapSettings, normalizeKeymapSettings, type KeymapSettings } from "./keymap";
import { KEYMAP_DEFAULTS_REVISION, migrateRetiredKeymapDefaults } from "./keymapDefaultsMigration";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";
import { gitDirectoryMappingPaths, normalizeGitDirectoryMappings } from "./gitRepositoryMapping";
import { normalizeGitCommitMessageHistory } from "./gitCommitMessageHistory";
import {
  normalizeSpeechDictationInputSetting,
  type SpeechInputSetting,
} from "./speechDictationInputSetting";
import { normalizeSpeechDictationLanguageSetting } from "./speechDictationLanguageSetting";
import type { SpeechLanguage } from "./speechDictation";
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
  normalizeAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "./agentNewThreadDefaults";
import {
  normalizeAgentProviderPreferences,
  type AgentProviderPreferences,
} from "./agentProviderSettings";
import { normalizeAppUpdaterSkippedVersion } from "./appUpdater";
import {
  normalizePersistedAgentWorkbenchSession,
  type AgentWorkbenchSessionPersisted,
} from "./agentWorkbenchLayoutThreads";
import { DEFAULT_APPEARANCE, normalizeAppearance, type AppearanceSettings } from "./appearance";
import { DEFAULT_WINDOW_ZOOM_LEVEL, normalizeWindowZoomLevel } from "./windowZoom";
import {
  normalizeLastCloneParentPath,
  normalizeRecentWorkspaceOpenedAt,
} from "./projectOnboardingSettings";

export type { MonacoAppTheme, TerminalTheme } from "./editorColorThemes";

export type BackgroundRuntimePolicy = "keepAlive" | "singleActive" | "suspendOnBackground";
export type SettingsSection =
  | "general"
  | "keymap"
  | "git"
  | "appearance"
  | "agents"
  | "environments"
  | "mcp"
  | "usage"
  | "archive";

const SETTINGS_SECTIONS: ReadonlySet<string> = new Set<SettingsSection>([
  "general",
  "keymap",
  "git",
  "appearance",
  "agents",
  "environments",
  "mcp",
  "usage",
  "archive",
]);

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && SETTINGS_SECTIONS.has(value);
}

export function parseSettingsSection(value: unknown): SettingsSection {
  return isSettingsSection(value) ? value : "general";
}

export const defaultEditorFontFamily =
  "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
export const defaultEditorFontLigatures = false;
export const defaultEditorFontSize = 14;
export const minEditorFontSize = 8;
export const maxEditorFontSize = 40;
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
  agentThreadNotifications?: boolean;
  agentThreadFontSize: number;
  agentModelFavoriteKeys: ReadonlyArray<AgentModelFavoriteKey>;
  agentModelFavoritesRevision: number;
  agentNewThreadDefaults?: AgentNewThreadDefaults;
  agentProviderPreferences: AgentProviderPreferences;
  maxConcurrentAgentTasks: number;
  speechDictationLanguage?: SpeechLanguage;
  speechDictationInput?: SpeechInputSetting;
  editorFontFamily: string;
  editorFontLigatures: boolean;
  editorFontSize: number;
  keymap: KeymapSettings;
  keymapDefaultsRevision: number;
  recentWorkspacePath: string | null;
  recentWorkspacePaths?: string[];
  recentWorkspaceOpenedAt?: Readonly<Record<string, number>>;
  lastCloneParentPath?: string | null;
  runtimePolicy: BackgroundRuntimePolicy;
  terminalShellIntegrationEnabled: boolean;
  appearance: AppearanceSettings;
  windowZoomLevel: number;
  workspaceTabs: string[];
}

export interface WorkspaceSettings {
  agentIsolationPolicy: AgentIsolationPolicy;
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
  session: WorkspaceSessionState;
  statusBar: StatusBarItemVisibility;
}

export const WORKSPACE_SESSION_VERSION = 1 as const;
export const MAX_RECENT_WORKSPACE_PATHS = 25;

export interface WorkspaceSessionStateV1 {
  agentWorkbench?: AgentWorkbenchSessionPersisted;
  version: typeof WORKSPACE_SESSION_VERSION;
}

export type WorkspaceSessionState = WorkspaceSessionStateV1;

export interface StatusBarItemVisibility {
  agentAttention: boolean;
}

export interface SettingsGateway {
  loadAppSettings(): Promise<AppSettings>;
  readInitialAppearance?(): AppearanceSettings;
  readInitialWindowZoomLevel?(): number;
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
    keymap: defaultKeymapSettings(),
    keymapDefaultsRevision: KEYMAP_DEFAULTS_REVISION,
    recentWorkspacePath: null,
    recentWorkspacePaths: [],
    recentWorkspaceOpenedAt: {},
    lastCloneParentPath: null,
    runtimePolicy: "keepAlive",
    terminalShellIntegrationEnabled: false,
    appearance: DEFAULT_APPEARANCE,
    windowZoomLevel: DEFAULT_WINDOW_ZOOM_LEVEL,
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

export function defaultWorkspaceSettings(): WorkspaceSettings {
  return {
    agentIsolationPolicy: DEFAULT_AGENT_ISOLATION_POLICY,
    gitCommitMessageHistory: [],
    gitDirectoryMappings: [],
    gitDirectoryMappingsAuto: true,
    session: defaultWorkspaceSessionState(),
    statusBar: defaultStatusBarItemVisibility(),
  };
}

export function defaultWorkspaceSessionState(): WorkspaceSessionState {
  return { version: WORKSPACE_SESSION_VERSION };
}

export function defaultStatusBarItemVisibility(): StatusBarItemVisibility {
  return { agentAttention: true };
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
  const keymapDefaults = migrateRetiredKeymapDefaults(value.keymap, value.keymapDefaultsRevision);
  const keymap = normalizeKeymapSettings(keymapDefaults.keymap);
  const runtimePolicy = isBackgroundRuntimePolicy(value.runtimePolicy)
    ? value.runtimePolicy
    : defaults.runtimePolicy;
  const terminalShellIntegrationEnabled = normalizeBoolean(
    value.terminalShellIntegrationEnabled,
    defaults.terminalShellIntegrationEnabled,
  );
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
    agentThreadNotifications: normalizeBoolean(value.agentThreadNotifications, true),
    agentThreadFontSize:
      value.agentThreadFontSize === undefined
        ? defaults.agentThreadFontSize
        : normalizeAgentThreadFontSize(value.agentThreadFontSize),
    agentModelFavoriteKeys: agentModelFavorites.keys,
    agentModelFavoritesRevision: agentModelFavorites.revision,
    agentNewThreadDefaults: normalizeAgentNewThreadDefaults(value.agentNewThreadDefaults),
    agentProviderPreferences: normalizeAgentProviderPreferences(value.agentProviderPreferences),
    maxConcurrentAgentTasks: normalizeMaxConcurrentAgentTasks(value.maxConcurrentAgentTasks),
    ...normalizeSpeechDictationLanguageSetting(value.speechDictationLanguage),
    ...normalizeSpeechDictationInputSetting(value.speechDictationInput),
    editorFontFamily,
    editorFontLigatures,
    editorFontSize,
    keymap,
    keymapDefaultsRevision: keymapDefaults.revision,
    recentWorkspacePath,
    recentWorkspacePaths,
    recentWorkspaceOpenedAt: normalizeRecentWorkspaceOpenedAt(value.recentWorkspaceOpenedAt),
    lastCloneParentPath: normalizeLastCloneParentPath(value.lastCloneParentPath),
    runtimePolicy,
    terminalShellIntegrationEnabled,
    appearance: normalizeAppearance(value.appearance, value.theme),
    windowZoomLevel: normalizeWindowZoomLevel(value.windowZoomLevel),
    workspaceTabs,
  };
}

export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  const defaults = defaultWorkspaceSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    agentIsolationPolicy: normalizeAgentIsolationPolicy(value.agentIsolationPolicy),
    gitCommitMessageHistory: normalizeGitCommitMessageHistory(value.gitCommitMessageHistory),
    gitDirectoryMappings: gitDirectoryMappingPaths(
      normalizeGitDirectoryMappings(value.gitDirectoryMappings),
    ),
    gitDirectoryMappingsAuto: normalizeBoolean(
      value.gitDirectoryMappingsAuto,
      defaults.gitDirectoryMappingsAuto,
    ),
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

  const agentWorkbench = normalizeWorkspaceSessionAgentWorkbench(value.agentWorkbench);

  if (!agentWorkbench) {
    return defaults;
  }

  return { agentWorkbench, version: WORKSPACE_SESSION_VERSION };
}

export function normalizeWorkspaceSessionAgentWorkbench(
  value: unknown,
): AgentWorkbenchSessionPersisted | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    return undefined;
  }

  return normalizePersistedAgentWorkbenchSession(value);
}

export function normalizeStatusBarItemVisibility(value: unknown): StatusBarItemVisibility {
  const defaults = defaultStatusBarItemVisibility();

  if (!isRecord(value)) {
    return defaults;
  }

  return {
    agentAttention: normalizeBoolean(value.agentAttention, defaults.agentAttention),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBackgroundRuntimePolicy(value: unknown): value is BackgroundRuntimePolicy {
  return value === "keepAlive" || value === "singleActive" || value === "suspendOnBackground";
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
