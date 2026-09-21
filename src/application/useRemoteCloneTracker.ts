import { useMemo, useRef } from "react";

export const REMOTE_CLONE_TRACKER_LIMIT = 8;

export type RemoteCloneTrackerKey = Readonly<{
  workspaceOwner: string | null;
  serverId: string | null;
}>;

export type RemoteCloneTrackerEntry = Readonly<{ cloneId: string; name: string }>;

export type RemoteCloneTracker = Readonly<{
  remember(key: RemoteCloneTrackerKey, entry: RemoteCloneTrackerEntry): void;
  forget(key: RemoteCloneTrackerKey): void;
  find(key: RemoteCloneTrackerKey): RemoteCloneTrackerEntry | null;
  size(): number;
}>;

const SEPARATOR = "\u0000";

export function remoteCloneTrackerKey(key: RemoteCloneTrackerKey): string | null {
  if (key.serverId === null) return null;
  return `${key.workspaceOwner ?? ""}${SEPARATOR}${key.serverId}`;
}

export interface RemoteCloneTrackerSession {
  current: Map<string, RemoteCloneTrackerEntry> | null;
}

export function useRemoteCloneTracker(session?: RemoteCloneTrackerSession): RemoteCloneTracker {
  const localEntries = useRef<Map<string, RemoteCloneTrackerEntry> | null>(null);
  const entries = session ?? localEntries;
  if (entries.current === null) entries.current = new Map();

  return useMemo(() => {
    const map = () => {
      if (entries.current === null) entries.current = new Map();
      return entries.current;
    };
    return {
      remember(key: RemoteCloneTrackerKey, entry: RemoteCloneTrackerEntry) {
        const identity = remoteCloneTrackerKey(key);
        if (identity === null) return;
        const tracked = map();
        tracked.delete(identity);
        tracked.set(identity, entry);
        evictOldest(tracked);
      },
      forget(key: RemoteCloneTrackerKey) {
        const identity = remoteCloneTrackerKey(key);
        if (identity === null) return;
        map().delete(identity);
      },
      find(key: RemoteCloneTrackerKey) {
        const identity = remoteCloneTrackerKey(key);
        if (identity === null) return null;
        return map().get(identity) ?? null;
      },
      size() {
        return map().size;
      },
    };
  }, [entries]);
}

function evictOldest(tracked: Map<string, RemoteCloneTrackerEntry>): void {
  while (tracked.size > REMOTE_CLONE_TRACKER_LIMIT) {
    const oldest = tracked.keys().next();
    if (oldest.done === true) return;
    tracked.delete(oldest.value);
  }
}
