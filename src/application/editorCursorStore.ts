import type { EditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorGroupId } from "../domain/editorGroups";
import type { EditorPosition } from "../domain/languageServerFeatures";

export const DEFAULT_EDITOR_CURSOR_STORE_MAX_GROUPS = 16;
export const MAX_EDITOR_CURSOR_ACTIVE_SUBSCRIBERS = 64;
export const MAX_EDITOR_CURSOR_GROUP_SUBSCRIBERS = 32;

export interface EditorCursorAuthority {
  readonly documentPath: string;
  readonly groupId: EditorGroupId;
  readonly ownerKey: EditorSessionOwnerKey;
}

export interface EditorCursorLease extends EditorCursorAuthority {
  readonly generation: number;
}

export type EditorCursorSnapshot =
  | {
      readonly status: "unavailable";
    }
  | {
      readonly authority: EditorCursorLease;
      readonly position: Readonly<EditorPosition> | null;
      readonly status: "available";
      readonly version: number;
    };

export interface EditorCursorStorePort {
  activate(authority: EditorCursorAuthority): EditorCursorLease | null;
  clear(lease: EditorCursorLease): boolean;
  deactivate(lease: EditorCursorLease): boolean;
  ensureActive(authority: EditorCursorAuthority): EditorCursorLease | null;
  getActiveSnapshot(): EditorCursorSnapshot;
  getSnapshot(lease: EditorCursorLease): EditorCursorSnapshot;
  publish(lease: EditorCursorLease, position: EditorPosition): boolean;
  subscribeActive(listener: () => void): () => void;
  subscribeGroup(lease: EditorCursorLease, listener: () => void): () => void;
}

export const UNAVAILABLE_EDITOR_CURSOR_SNAPSHOT: EditorCursorSnapshot = Object.freeze({
  status: "unavailable",
});

interface StoredCursor {
  readonly authority: EditorCursorLease;
  lastAccess: number;
  readonly listeners: Set<() => void>;
  snapshot: EditorCursorSnapshot;
  version: number;
}

/**
 * Exact-owner external store for the high-frequency Monaco cursor stream.
 *
 * A lease represents one activation incarnation, not merely a path. Returning
 * to the same workspace/group/document after activating another surface issues
 * a fresh generation, so delayed A → B → A events fail closed.
 */
export class EditorCursorStore implements EditorCursorStorePort {
  private readonly activeListeners = new Set<() => void>();
  private active: StoredCursor | null = null;
  private accessClock = 0;
  private generation = 0;
  private readonly maxGroups: number;
  private readonly onListenerError: (error: unknown) => void;
  private publishing = false;
  private readonly retainedByGroup = new Map<EditorGroupId, StoredCursor>();

  constructor(
    maxGroups = DEFAULT_EDITOR_CURSOR_STORE_MAX_GROUPS,
    onListenerError: (error: unknown) => void = () => {},
  ) {
    if (!Number.isSafeInteger(maxGroups) || maxGroups < 1 || maxGroups > 256) {
      throw new TypeError("Editor cursor store maxGroups must be an integer between 1 and 256");
    }
    this.maxGroups = maxGroups;
    this.onListenerError = onListenerError;
  }

  activate(authority: EditorCursorAuthority): EditorCursorLease | null {
    if (this.publishing || !validAuthority(authority)) return null;

    const previousForGroup = this.retainedByGroup.get(authority.groupId);
    const lease = freezeLease(authority, ++this.generation);
    const stored: StoredCursor = {
      authority: lease,
      lastAccess: this.tick(),
      listeners: new Set(),
      snapshot: availableSnapshot(lease, null, 0),
      version: 0,
    };

    this.retainedByGroup.set(authority.groupId, stored);
    this.active = stored;
    if (previousForGroup) this.emit(previousForGroup.listeners);
    this.evictOverflow();
    this.emit(this.activeListeners);
    return lease;
  }

  ensureActive(authority: EditorCursorAuthority): EditorCursorLease | null {
    if (this.publishing || !validAuthority(authority)) return null;
    if (this.active && authoritiesEqual(this.active.authority, authority)) {
      this.active.lastAccess = this.tick();
      return this.active.authority;
    }
    return this.activate(authority);
  }

  clear(lease: EditorCursorLease): boolean {
    if (this.publishing) return false;
    const stored = this.current(lease);
    if (!stored) return false;

    stored.version += 1;
    stored.lastAccess = this.tick();
    stored.snapshot = availableSnapshot(stored.authority, null, stored.version);
    this.emit(stored.listeners);
    if (this.active === stored) this.emit(this.activeListeners);
    return true;
  }

  deactivate(lease: EditorCursorLease): boolean {
    if (this.publishing || !this.active || !leasesEqual(this.active.authority, lease)) {
      return false;
    }
    const previous = this.active;
    this.active = null;
    this.emit(previous.listeners);
    this.emit(this.activeListeners);
    return true;
  }

  getActiveSnapshot(): EditorCursorSnapshot {
    return this.active?.snapshot ?? UNAVAILABLE_EDITOR_CURSOR_SNAPSHOT;
  }

  getSnapshot(lease: EditorCursorLease): EditorCursorSnapshot {
    return this.current(lease)?.snapshot ?? UNAVAILABLE_EDITOR_CURSOR_SNAPSHOT;
  }

  publish(lease: EditorCursorLease, position: EditorPosition): boolean {
    if (this.publishing || !validPosition(position)) return false;
    const stored = this.current(lease);
    if (!stored || stored !== this.active) return false;

    const currentPosition =
      stored.snapshot.status === "available" ? stored.snapshot.position : null;
    if (
      currentPosition?.lineNumber === position.lineNumber &&
      currentPosition.column === position.column
    ) {
      return true;
    }

    stored.version += 1;
    stored.lastAccess = this.tick();
    stored.snapshot = availableSnapshot(stored.authority, position, stored.version);
    this.emit(stored.listeners);
    this.emit(this.activeListeners);
    return true;
  }

  subscribeActive(listener: () => void): () => void {
    if (
      typeof listener !== "function" ||
      this.activeListeners.size >= MAX_EDITOR_CURSOR_ACTIVE_SUBSCRIBERS
    ) {
      return () => {};
    }
    this.activeListeners.add(listener);
    return () => this.activeListeners.delete(listener);
  }

  subscribeGroup(lease: EditorCursorLease, listener: () => void): () => void {
    const stored = this.current(lease);
    if (
      !stored ||
      typeof listener !== "function" ||
      stored.listeners.size >= MAX_EDITOR_CURSOR_GROUP_SUBSCRIBERS
    ) {
      return () => {};
    }
    stored.listeners.add(listener);
    return () => stored.listeners.delete(listener);
  }

  private current(lease: EditorCursorLease): StoredCursor | null {
    if (!validLease(lease)) return null;
    const stored = this.retainedByGroup.get(lease.groupId);
    return stored && leasesEqual(stored.authority, lease) ? stored : null;
  }

  private emit(listeners: ReadonlySet<() => void>): void {
    if (listeners.size === 0) return;
    this.publishing = true;
    try {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          try {
            this.onListenerError(error);
          } catch {
            // Error reporting must not strand the already-settled cursor mutation.
          }
        }
      }
    } finally {
      this.publishing = false;
    }
  }

  private evictOverflow(): void {
    while (this.retainedByGroup.size > this.maxGroups) {
      let candidate: StoredCursor | null = null;
      for (const stored of this.retainedByGroup.values()) {
        if (stored !== this.active && (!candidate || stored.lastAccess < candidate.lastAccess)) {
          candidate = stored;
        }
      }
      if (!candidate) return;
      this.retainedByGroup.delete(candidate.authority.groupId);
      this.emit(candidate.listeners);
      candidate.listeners.clear();
    }
  }

  private tick(): number {
    this.accessClock += 1;
    return this.accessClock;
  }
}

function availableSnapshot(
  authority: EditorCursorLease,
  position: EditorPosition | null,
  version: number,
): EditorCursorSnapshot {
  return Object.freeze({
    authority,
    position: position ? Object.freeze({ ...position }) : null,
    status: "available",
    version,
  });
}

function freezeLease(authority: EditorCursorAuthority, generation: number): EditorCursorLease {
  return Object.freeze({
    documentPath: authority.documentPath,
    generation,
    groupId: authority.groupId,
    ownerKey: authority.ownerKey,
  });
}

function validAuthority(authority: EditorCursorAuthority): boolean {
  return Boolean(
    authority &&
    typeof authority.documentPath === "string" &&
    authority.documentPath.length > 0 &&
    authority.documentPath.length <= 32_768 &&
    typeof authority.groupId === "string" &&
    authority.groupId.length > 0 &&
    authority.groupId.length <= 256 &&
    typeof authority.ownerKey === "string" &&
    authority.ownerKey.length > 0 &&
    authority.ownerKey.length <= 32_768,
  );
}

function validLease(lease: EditorCursorLease): boolean {
  return validAuthority(lease) && Number.isSafeInteger(lease.generation) && lease.generation > 0;
}

function validPosition(position: EditorPosition): boolean {
  return Boolean(
    position &&
    Number.isSafeInteger(position.lineNumber) &&
    position.lineNumber > 0 &&
    Number.isSafeInteger(position.column) &&
    position.column > 0,
  );
}

function authoritiesEqual(left: EditorCursorAuthority, right: EditorCursorAuthority): boolean {
  return (
    left.ownerKey === right.ownerKey &&
    left.groupId === right.groupId &&
    left.documentPath === right.documentPath
  );
}

function leasesEqual(left: EditorCursorLease, right: EditorCursorLease): boolean {
  return left.generation === right.generation && authoritiesEqual(left, right);
}
