import type { RemoteFileContent, RemoteSurfaceScope } from "../domain/remoteRunnerSurfaces";

export type RemoteFileDraft = Readonly<{
  path: string;
  text: string;
  original: string;
  version: string;
}>;
type SavedEvent = Readonly<{ file: RemoteFileContent; expectedVersion: string; text: string }>;
type SaveTicket = Readonly<{ id: string; generation: number; expectedVersion: string }>;
const MAX_DRAFTS = 12;
// Admission budget. A successful in-flight save may need up to one bounded
// server-file baseline per retained draft as settlement headroom; never drop edits.
const MAX_DRAFT_CHARACTERS = 2_000_000;
export function createRemoteFileDraftStore() {
  let generation = 0;
  const writes = new Map<string, SaveTicket>();
  const listeners = new Map<string, Set<(event: SavedEvent) => void>>();
  const drafts = new Map<string, RemoteFileDraft>();
  const prefix = (scope: RemoteSurfaceScope) =>
    JSON.stringify([scope.serverId, scope.runnerId, scope.projectId, scope.taskId ?? null]);
  const key = (scope: RemoteSurfaceScope, path: string) => `${prefix(scope)}:${path}`;
  return {
    subscribe(scope: RemoteSurfaceScope, callback: (event: SavedEvent) => void) {
      const id = prefix(scope);
      const callbacks = listeners.get(id) ?? new Set();
      callbacks.add(callback);
      listeners.set(id, callbacks);
      return () => {
        callbacks.delete(callback);
        if (callbacks.size === 0) listeners.delete(id);
      };
    },
    isSaving: (scope: RemoteSurfaceScope, path: string) => writes.has(key(scope, path)),
    beginSave(scope: RemoteSurfaceScope, path: string, expectedVersion: string): SaveTicket | null {
      if (writes.size >= MAX_DRAFTS && !writes.has(key(scope, path))) return null;
      const ticket = { id: key(scope, path), generation: ++generation, expectedVersion };
      writes.set(ticket.id, ticket);
      return ticket;
    },
    failSave(ticket: SaveTicket) {
      if (writes.get(ticket.id) === ticket) writes.delete(ticket.id);
    },
    completeSave(scope: RemoteSurfaceScope, ticket: SaveTicket, file: RemoteFileContent) {
      if (writes.get(ticket.id) !== ticket || !file.version) return;
      writes.delete(ticket.id);
      const draft = drafts.get(ticket.id);
      if (draft && draft.version !== ticket.expectedVersion) return;
      const text = draft?.text ?? file.text;
      if (text === file.text) drafts.delete(ticket.id);
      else
        drafts.set(ticket.id, {
          path: file.path,
          text,
          original: file.text,
          version: file.version,
        });
      for (const listener of listeners.get(prefix(scope)) ?? [])
        listener({ file, expectedVersion: ticket.expectedVersion, text });
    },
    get: (scope: RemoteSurfaceScope, path: string) => drafts.get(key(scope, path)),
    first: (scope: RemoteSurfaceScope) =>
      [...drafts.entries()].find(([id]) => id.startsWith(`${prefix(scope)}:`))?.[1],
    put(scope: RemoteSurfaceScope, draft: RemoteFileDraft) {
      const id = key(scope, draft.path);
      if (!drafts.has(id) && drafts.size >= MAX_DRAFTS) return false;
      let characters = draft.text.length + draft.original.length;
      for (const [other, value] of drafts)
        if (other !== id) characters += value.text.length + value.original.length;
      if (characters > MAX_DRAFT_CHARACTERS) return false;
      drafts.set(id, draft);
      return true;
    },
    removeIfSame(scope: RemoteSurfaceScope, path: string, expected: RemoteFileDraft | undefined) {
      const id = key(scope, path);
      if (expected && drafts.get(id) === expected) drafts.delete(id);
    },
    remove(scope: RemoteSurfaceScope, path: string) {
      drafts.delete(key(scope, path));
    },
  };
}
// Session-owned drafts survive panel unmounts; never evict unsaved content.
export const remoteFileDrafts = createRemoteFileDraftStore();
