import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeAppSettings,
  normalizeWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSettings,
  type WorkspaceSettingsIdentity,
} from "../domain/settings";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const APP_SETTINGS_KEY = "editor.settings.app";
const CANONICAL_WORKSPACE_SETTINGS_PREFIX =
  "editor.settings.workspace:canonical:";
const LEGACY_WORKSPACE_SETTINGS_PREFIX = "editor.settings.workspace:";

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

  async loadWorkspaceSettings(
    identity: string | WorkspaceSettingsIdentity,
  ): Promise<WorkspaceSettings> {
    const keys = workspaceSettingsKeys(identity);
    const canonicalValue = this.storage.getItem(keys.canonical);
    if (canonicalValue !== null) {
      return normalizeWorkspaceSettings(
        readJson(canonicalValue, defaultWorkspaceSettings()),
      );
    }

    for (const legacyKey of keys.legacy) {
      const legacyValue = this.storage.getItem(legacyKey);
      if (legacyValue === null) {
        continue;
      }

      const parsedLegacyValue = parseJson(legacyValue);
      if (!parsedLegacyValue.ok) {
        continue;
      }

      const settings = normalizeWorkspaceSettings(parsedLegacyValue.value);
      this.storage.setItem(keys.canonical, legacyValue);
      this.storage.removeItem(legacyKey);
      return settings;
    }

    return defaultWorkspaceSettings();
  }

  async saveWorkspaceSettings(
    identity: string | WorkspaceSettingsIdentity,
    settings: WorkspaceSettings,
  ): Promise<void> {
    const keys = workspaceSettingsKeys(identity);
    this.storage.setItem(keys.canonical, JSON.stringify(settings));
    for (const legacyKey of keys.legacy) {
      this.storage.removeItem(legacyKey);
    }
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

function parseJson(value: string):
  | { ok: true; value: unknown }
  | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function legacyWorkspaceSettingsKey(rootPath: string): string {
  return `${LEGACY_WORKSPACE_SETTINGS_PREFIX}${encodeURIComponent(rootPath)}`;
}

function canonicalWorkspaceSettingsKey(canonicalKey: string): string {
  return `${CANONICAL_WORKSPACE_SETTINGS_PREFIX}${encodeURIComponent(canonicalKey)}`;
}

function workspaceSettingsKeys(
  identity: string | WorkspaceSettingsIdentity,
): { canonical: string; legacy: string[] } {
  if (typeof identity === "string") {
    return { canonical: legacyWorkspaceSettingsKey(identity), legacy: [] };
  }

  const canonical = canonicalWorkspaceSettingsKey(identity.canonicalKey);
  if (!identity.legacyRawKeys) {
    return { canonical, legacy: [] };
  }

  return {
    canonical,
    legacy: [...new Set(identity.legacyRawKeys.map(legacyWorkspaceSettingsKey))],
  };
}
