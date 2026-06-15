import type { IntelligenceMode } from "./workspace";

export interface AppSettings {
  recentWorkspacePath: string | null;
}

export interface WorkspaceSettings {
  intelligenceMode: IntelligenceMode;
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
  };
}

export function defaultWorkspaceSettings(): WorkspaceSettings {
  return {
    intelligenceMode: "basic",
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    return defaultAppSettings();
  }

  if (
    typeof value.recentWorkspacePath !== "string" &&
    value.recentWorkspacePath !== null
  ) {
    return defaultAppSettings();
  }

  return {
    recentWorkspacePath: value.recentWorkspacePath,
  };
}

export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  if (!isRecord(value)) {
    return defaultWorkspaceSettings();
  }

  if (!isIntelligenceMode(value.intelligenceMode)) {
    return defaultWorkspaceSettings();
  }

  return {
    intelligenceMode: value.intelligenceMode,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIntelligenceMode(value: unknown): value is IntelligenceMode {
  return value === "basic" || value === "lightSmart" || value === "fullSmart";
}
