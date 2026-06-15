import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeAppSettings,
  normalizeWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSettings,
} from "../domain/settings";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const APP_SETTINGS_KEY = "editor.settings.app";
const WORKSPACE_SETTINGS_PREFIX = "editor.settings.workspace:";

export class BrowserSettingsGateway implements SettingsGateway {
  constructor(private readonly storage: KeyValueStorage = localStorage) {}

  loadAppSettings(): Promise<AppSettings> {
    return Promise.resolve(
      readJson(this.storage.getItem(APP_SETTINGS_KEY), defaultAppSettings()),
    ).then(normalizeAppSettings);
  }

  saveAppSettings(settings: AppSettings): Promise<void> {
    this.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
    return Promise.resolve();
  }

  loadWorkspaceSettings(rootPath: string): Promise<WorkspaceSettings> {
    return Promise.resolve(
      readJson(
        this.storage.getItem(workspaceSettingsKey(rootPath)),
        defaultWorkspaceSettings(),
      ),
    ).then(normalizeWorkspaceSettings);
  }

  saveWorkspaceSettings(
    rootPath: string,
    settings: WorkspaceSettings,
  ): Promise<void> {
    this.storage.setItem(workspaceSettingsKey(rootPath), JSON.stringify(settings));
    return Promise.resolve();
  }
}

function readJson(value: string | null, fallback: unknown): unknown {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function workspaceSettingsKey(rootPath: string): string {
  return `${WORKSPACE_SETTINGS_PREFIX}${encodeURIComponent(rootPath)}`;
}
