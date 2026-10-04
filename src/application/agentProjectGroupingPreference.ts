import {
  DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
  encodeAgentProjectGroupingSettings,
  parseAgentProjectGroupingSettings,
  withAgentProjectGroupingMode,
  withAgentProjectGroupingOverride,
  withoutAgentProjectGroupingOverrides,
  type AgentProjectGroupingMode,
  type AgentProjectGroupingRejection,
  type AgentProjectGroupingSettings,
  type AgentProjectGroupingUpdate,
} from "../domain/agentProjectGrouping";

export const AGENT_PROJECT_GROUPING_STORAGE_KEY = "codevo.project-grouping.v1";
const MAX_STORAGE_CHARS = 2_000_000;

export type AgentProjectGroupingStorageState = "readable" | "corrupt";

export type AgentProjectGroupingWriteRejection =
  AgentProjectGroupingRejection | "storageCorrupt" | "storageUnavailable";

export type AgentProjectGroupingWrite =
  | { readonly kind: "saved" }
  | { readonly kind: "rejected"; readonly reason: AgentProjectGroupingWriteRejection };

interface StoredGrouping {
  readonly state: AgentProjectGroupingStorageState;
  readonly settings: AgentProjectGroupingSettings;
}

const READABLE_DEFAULT: StoredGrouping = {
  state: "readable",
  settings: DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
};
const CORRUPT: StoredGrouping = {
  state: "corrupt",
  settings: DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
};
const SAVED: AgentProjectGroupingWrite = { kind: "saved" };

let cachedRaw: string | null | undefined;
let cachedStored: StoredGrouping = READABLE_DEFAULT;
const subscribers = new Set<() => void>();

function publish(): void {
  cachedRaw = undefined;
  for (const notify of subscribers) notify();
}

export function subscribeAgentProjectGrouping(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === AGENT_PROJECT_GROUPING_STORAGE_KEY || event.key === null) publish();
  });
}

export function readAgentProjectGrouping(): AgentProjectGroupingSettings {
  return (readStored() ?? READABLE_DEFAULT).settings;
}

export function readAgentProjectGroupingStorageState(): AgentProjectGroupingStorageState {
  return (readStored() ?? READABLE_DEFAULT).state;
}

export function saveAgentProjectGroupingMode(
  mode: AgentProjectGroupingMode,
): AgentProjectGroupingWrite {
  return write((settings) => withAgentProjectGroupingMode(settings, mode));
}

export function saveAgentProjectGroupingOverride(
  rootKey: string,
  mode: AgentProjectGroupingMode | null,
): AgentProjectGroupingWrite {
  return write((settings) => withAgentProjectGroupingOverride(settings, rootKey, mode));
}

export function clearAgentProjectGroupingOverrides(
  rootKeys: ReadonlyArray<string>,
): AgentProjectGroupingWrite {
  return write((settings) => withoutAgentProjectGroupingOverrides(settings, rootKeys));
}

export function resetAgentProjectGrouping(): AgentProjectGroupingWrite {
  try {
    window.localStorage.removeItem(AGENT_PROJECT_GROUPING_STORAGE_KEY);
  } catch {
    return rejected("storageUnavailable");
  }
  publish();
  return SAVED;
}

function readStored(): StoredGrouping | null {
  try {
    const raw = window.localStorage.getItem(AGENT_PROJECT_GROUPING_STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedStored = decode(raw);
      cachedRaw = raw;
    }
    return cachedStored;
  } catch {
    return null;
  }
}

function decode(raw: string | null): StoredGrouping {
  if (raw === null) return READABLE_DEFAULT;
  if (raw.length > MAX_STORAGE_CHARS) return CORRUPT;
  const settings = parseAgentProjectGroupingSettings(parseJson(raw));
  if (settings === null) return CORRUPT;
  return { state: "readable", settings };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(
  change: (settings: AgentProjectGroupingSettings) => AgentProjectGroupingUpdate,
): AgentProjectGroupingWrite {
  const stored = readStored();
  if (stored === null) return rejected("storageUnavailable");
  if (stored.state === "corrupt") return rejected("storageCorrupt");
  const update = change(stored.settings);
  if (update.kind === "rejected") return rejected(update.reason);
  if (update.settings === stored.settings) return SAVED;
  return commit(update.settings);
}

function commit(settings: AgentProjectGroupingSettings): AgentProjectGroupingWrite {
  const encoded = JSON.stringify(encodeAgentProjectGroupingSettings(settings));
  if (encoded.length > MAX_STORAGE_CHARS) return rejected("tooManyOverrides");
  try {
    window.localStorage.setItem(AGENT_PROJECT_GROUPING_STORAGE_KEY, encoded);
  } catch {
    return rejected("storageUnavailable");
  }
  publish();
  return SAVED;
}

function rejected(reason: AgentProjectGroupingWriteRejection): AgentProjectGroupingWrite {
  return { kind: "rejected", reason };
}
