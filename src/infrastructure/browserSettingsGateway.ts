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
const CANONICAL_WORKSPACE_SETTINGS_PREFIX = "editor.settings.workspace:canonical:";
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
      return normalizeWorkspaceSettings(readJson(canonicalValue, defaultWorkspaceSettings()));
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
    let quotaError: unknown = null;

    for (const serialized of serializedWorkspaceSettingsCandidates(settings)) {
      const saved = trySetItem(this.storage, keys.canonical, serialized);
      if (saved.ok) {
        quotaError = null;
        break;
      }
      if (!isQuotaExceededError(saved.error)) {
        throw saved.error;
      }
      quotaError = saved.error;
    }

    if (quotaError) {
      throw quotaError;
    }

    for (const legacyKey of keys.legacy) {
      this.storage.removeItem(legacyKey);
    }
  }
}

function trySetItem(
  storage: KeyValueStorage,
  key: string,
  value: string,
): { ok: true } | { error: unknown; ok: false } {
  try {
    storage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return { error, ok: false };
  }
}

function isQuotaExceededError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.name === "QuotaExceededError" || candidate.code === 22;
}

function serializedWorkspaceSettingsCandidates(settings: WorkspaceSettings): string[] {
  const sessionWithoutNavigation = { ...settings.session };
  delete sessionWithoutNavigation.navigation;

  return [
    ...new Set([
      JSON.stringify(settings),
      JSON.stringify({ ...settings, session: sessionWithoutNavigation }),
      JSON.stringify({ ...settings, session: defaultWorkspaceSettings().session }),
    ]),
  ];
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

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
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

function workspaceSettingsKeys(identity: string | WorkspaceSettingsIdentity): {
  canonical: string;
  legacy: string[];
} {
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
