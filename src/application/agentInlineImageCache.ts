export const MAX_AGENT_INLINE_IMAGE_ENTRIES = 32;
export const MAX_AGENT_INLINE_IMAGE_CACHE_BYTES = 64 * 1_024 * 1_024;
export const MAX_AGENT_INLINE_IMAGE_RETAINED_FAILURES = 32;
export const MAX_AGENT_INLINE_IMAGE_PINS = 128;
export const AGENT_INLINE_IMAGE_CACHE_LIMIT_REASON =
  "Image preview limit reached. This image loads by itself once others scroll out of view.";
export const AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON =
  "This image does not fit in the preview memory right now.";

const KEY_SEPARATOR = "\u0000";
const LOADING_STATE: AgentInlineImageState = Object.freeze({ kind: "loading" });
const PRESENT: AgentInlineImageAdmission = Object.freeze({ kind: "present" });
const REFUSED: AgentInlineImageAdmission = Object.freeze({ kind: "refused" });

export type AgentInlineImageState =
  | { readonly kind: "loading" }
  | { readonly kind: "waiting" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export type AgentInlineImagePin = "pinned" | "refused";

export interface AgentInlineImageThreadOwner {
  readonly workspaceId: string;
  readonly threadId: string;
}

export interface AgentInlineImageIdentity extends AgentInlineImageThreadOwner {
  readonly scope: string;
  readonly path: string;
}

export interface AgentInlineImageLease {
  readonly key: string;
}

export type AgentInlineImageAdmission =
  | { readonly kind: "admitted"; readonly lease: AgentInlineImageLease }
  | { readonly kind: "present" }
  | { readonly kind: "refused" };

export type AgentInlineImageThreadRelease = "held" | "released";

export interface AgentInlineImageCache {
  version(): number;
  stateOf(key: string): AgentInlineImageState | undefined;
  touch(key: string): boolean;
  begin(key: string): AgentInlineImageAdmission;
  isCurrent(lease: AgentInlineImageLease): boolean;
  fail(lease: AgentInlineImageLease, reason: string): void;
  resolve(lease: AgentInlineImageLease, bytes: number, createUrl: () => string): void;
  forget(key: string): boolean;
  refuse(key: string, reason: string): void;
  pin(key: string): AgentInlineImagePin;
  unpin(key: string): void;
  isPinned(key: string): boolean;
  holdThread(owner: AgentInlineImageThreadOwner): void;
  releaseThread(owner: AgentInlineImageThreadOwner): AgentInlineImageThreadRelease;
  clear(): void;
}

interface CacheEntry extends AgentInlineImageLease {
  state: AgentInlineImageState;
  bytes: number;
}

export function agentInlineImageThreadPrefix(owner: AgentInlineImageThreadOwner): string {
  return `${owner.workspaceId}${KEY_SEPARATOR}${owner.threadId}${KEY_SEPARATOR}`;
}

export function agentInlineImageKey(identity: AgentInlineImageIdentity): string {
  return `${agentInlineImageThreadPrefix(identity)}${identity.scope}${KEY_SEPARATOR}${identity.path}`;
}

export function createAgentInlineImageCache(
  revokeObjectUrl: (url: string) => void,
): AgentInlineImageCache {
  const entries = new Map<string, CacheEntry>();
  const pins = new Map<string, number>();
  const holds = new Map<string, number>();
  let version = 0;

  const remove = (key: string): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entries.delete(key);
    version += 1;
    if (entry.state.kind !== "ready") return;
    revokeObjectUrl(entry.state.url);
  };

  const settle = (entry: CacheEntry, state: AgentInlineImageState, bytes: number): void => {
    entry.state = state;
    entry.bytes = bytes;
    version += 1;
  };

  const evictablePreviews = (): ReadonlyArray<CacheEntry> =>
    [...entries.values()].filter((entry) => entry.state.kind === "ready" && !pins.has(entry.key));

  const previewCount = (): number => {
    let total = 0;
    for (const entry of entries.values()) {
      if (entry.state.kind !== "unavailable") total += 1;
    }
    return total;
  };

  const pinCount = (): number => {
    let total = 0;
    for (const count of pins.values()) total += count;
    return total;
  };

  const makePreviewRoom = (): boolean => {
    const excess = previewCount() - MAX_AGENT_INLINE_IMAGE_ENTRIES + 1;
    if (excess <= 0) return true;
    const candidates = evictablePreviews();
    if (candidates.length < excess) return false;
    for (const entry of candidates.slice(0, excess)) remove(entry.key);
    return true;
  };

  const retainedBytes = (): number => {
    let total = 0;
    for (const entry of entries.values()) total += entry.bytes;
    return total;
  };

  const makeByteRoom = (bytes: number): boolean => {
    const excess = retainedBytes() + bytes - MAX_AGENT_INLINE_IMAGE_CACHE_BYTES;
    if (excess <= 0) return true;
    const candidates = evictablePreviews();
    const reclaimable = candidates.reduce((total, entry) => total + entry.bytes, 0);
    if (reclaimable < excess) return false;
    let reclaimed = 0;
    for (const entry of candidates) {
      if (reclaimed >= excess) return true;
      reclaimed += entry.bytes;
      remove(entry.key);
    }
    return true;
  };

  const trimRetainedFailures = (): void => {
    const retained = [...entries.values()].filter(
      (entry) => entry.state.kind === "unavailable" && !pins.has(entry.key),
    );
    const excess = retained.length - MAX_AGENT_INLINE_IMAGE_RETAINED_FAILURES;
    for (const entry of retained.slice(0, Math.max(0, excess))) remove(entry.key);
  };

  const current = (lease: AgentInlineImageLease): CacheEntry | null => {
    const entry = entries.get(lease.key);
    if (entry === undefined || entry !== lease || entry.state.kind !== "loading") return null;
    return entry;
  };

  return {
    version: () => version,
    stateOf(key) {
      return entries.get(key)?.state;
    },
    touch(key) {
      const entry = entries.get(key);
      if (entry === undefined) return false;
      entries.delete(key);
      entries.set(key, entry);
      return true;
    },
    begin(key) {
      if (entries.has(key)) return PRESENT;
      if (!makePreviewRoom()) return REFUSED;
      const entry: CacheEntry = { key, state: LOADING_STATE, bytes: 0 };
      entries.set(key, entry);
      version += 1;
      return { kind: "admitted", lease: entry };
    },
    isCurrent(lease) {
      return current(lease) !== null;
    },
    fail(lease, reason) {
      const entry = current(lease);
      if (entry === null) return;
      settle(entry, { kind: "unavailable", reason }, 0);
      trimRetainedFailures();
    },
    resolve(lease, bytes, createUrl) {
      const entry = current(lease);
      if (entry === null) return;
      if (!makeByteRoom(bytes)) {
        settle(entry, { kind: "unavailable", reason: AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON }, 0);
        trimRetainedFailures();
        return;
      }
      settle(entry, { kind: "ready", url: createUrl() }, bytes);
    },
    forget(key) {
      const entry = entries.get(key);
      if (entry === undefined || entry.state.kind === "loading") return false;
      remove(key);
      return true;
    },
    refuse(key, reason) {
      if (entries.has(key)) return;
      entries.set(key, { key, state: { kind: "unavailable", reason }, bytes: 0 });
      version += 1;
      trimRetainedFailures();
    },
    pin(key) {
      if (pinCount() >= MAX_AGENT_INLINE_IMAGE_PINS) return "refused";
      pins.set(key, (pins.get(key) ?? 0) + 1);
      return "pinned";
    },
    unpin(key) {
      const remaining = (pins.get(key) ?? 0) - 1;
      if (remaining > 0) {
        pins.set(key, remaining);
        return;
      }
      pins.delete(key);
      trimRetainedFailures();
    },
    isPinned(key) {
      return pins.has(key);
    },
    holdThread(owner) {
      const prefix = agentInlineImageThreadPrefix(owner);
      holds.set(prefix, (holds.get(prefix) ?? 0) + 1);
    },
    releaseThread(owner) {
      const prefix = agentInlineImageThreadPrefix(owner);
      const remaining = (holds.get(prefix) ?? 0) - 1;
      if (remaining > 0) {
        holds.set(prefix, remaining);
        return "held";
      }
      holds.delete(prefix);
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) remove(key);
      }
      return "released";
    },
    clear() {
      [...entries.keys()].forEach(remove);
    },
  };
}
