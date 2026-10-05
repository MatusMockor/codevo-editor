// Account limits are shared across workspaces; dismissals have the same scope.
const STORAGE_KEY = "editor.agentComposer.usageDismissals.v1";
const MAX_KEYS = 64;
const MAX_KEY_LENGTH = 4096;
const MAX_STORAGE_LENGTH = MAX_KEYS * (MAX_KEY_LENGTH * 6 + 4) + 2;
const subscribers = new Set<() => void>();
let unsaved: string | null = null;

export function loadComposerUsageDismissals(): string {
  if (unsaved !== null) return unsaved;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function parseComposerUsageDismissals(raw: string): ReadonlySet<string> {
  if (raw.length > MAX_STORAGE_LENGTH) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > MAX_KEYS) return new Set();
    if (!value.every((key) => typeof key === "string" && key.length <= MAX_KEY_LENGTH)) {
      return new Set();
    }
    return new Set(value as string[]);
  } catch {
    return new Set();
  }
}

export function dismissComposerUsageWindows(keys: ReadonlyArray<string>): void {
  const merged = new Set(parseComposerUsageDismissals(loadComposerUsageDismissals()));
  for (const key of keys) {
    if (key.length > MAX_KEY_LENGTH) continue;
    merged.delete(key);
    merged.add(key);
  }
  const raw = JSON.stringify([...merged].slice(-MAX_KEYS));
  unsaved = raw;
  try {
    localStorage.setItem(STORAGE_KEY, raw);
    unsaved = null;
  } catch {
    // Retain dismissal for this app session when persistence is unavailable.
  }
  for (const notify of subscribers) notify();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  if (event.storageArea !== localStorage) return;
  unsaved = null;
  for (const notify of subscribers) notify();
}

export function subscribeComposerUsageDismissals(notify: () => void): () => void {
  if (subscribers.size === 0) window.addEventListener("storage", onStorage);
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) window.removeEventListener("storage", onStorage);
  };
}
