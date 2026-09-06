import { useCallback, useMemo, useRef, useState } from "react";

export const COMPOSER_REPOSITORY_PREFERENCE_KEY = "editor.agentComposer.repositories.v1";
export const MAX_COMPOSER_REPOSITORY_PREFERENCES = 32;
const MAX_PATH_BYTES = 4_096;
const MAX_STORAGE_BYTES = 300_000;

export interface ComposerRepositoryPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Preference {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
}

export function useAgentComposerRepositoryPreference(
  storage?: ComposerRepositoryPreferenceStorage,
) {
  const [entries, setEntries] = useState(() => loadPreferences(storage));
  const entriesRef = useRef(entries);
  const preferences = useMemo(
    () => new Map(entries.map((entry) => [entry.projectRootKey, entry.repositoryRoot])),
    [entries],
  );
  const rememberRepository = useCallback(
    (projectRootKey: string, repositoryRoot: string) => {
      if (!validPath(projectRootKey) || !validPath(repositoryRoot)) return;
      const next = [
        { projectRootKey, repositoryRoot },
        ...entriesRef.current.filter((entry) => entry.projectRootKey !== projectRootKey),
      ].slice(0, MAX_COMPOSER_REPOSITORY_PREFERENCES);
      let serialized = JSON.stringify({ version: 1, entries: next });
      while (new TextEncoder().encode(serialized).byteLength > MAX_STORAGE_BYTES) {
        next.pop();
        serialized = JSON.stringify({ version: 1, entries: next });
      }
      entriesRef.current = next;
      setEntries(next);
      try {
        availableStorage(storage)?.setItem(COMPOSER_REPOSITORY_PREFERENCE_KEY, serialized);
      } catch {
        return;
      }
    },
    [storage],
  );
  return { preferences, rememberRepository };
}

function availableStorage(
  storage: ComposerRepositoryPreferenceStorage | undefined,
): ComposerRepositoryPreferenceStorage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function loadPreferences(
  storage: ComposerRepositoryPreferenceStorage | undefined,
): readonly Preference[] {
  try {
    const raw = availableStorage(storage)?.getItem(COMPOSER_REPOSITORY_PREFERENCE_KEY);
    if (raw === null || raw === undefined || raw.length > MAX_STORAGE_BYTES) return [];
    if (new TextEncoder().encode(raw).byteLength > MAX_STORAGE_BYTES) return [];
    const record: unknown = JSON.parse(raw);
    if (!isRecord(record) || Object.keys(record).length !== 2 || record.version !== 1) return [];
    if (!Array.isArray(record.entries)) return [];
    if (record.entries.length > MAX_COMPOSER_REPOSITORY_PREFERENCES) return [];
    const entries: Preference[] = [];
    const roots = new Set<string>();
    for (const entry of record.entries) {
      if (!isRecord(entry) || Object.keys(entry).length !== 2) return [];
      if (!validPath(entry.projectRootKey) || !validPath(entry.repositoryRoot)) return [];
      if (roots.has(entry.projectRootKey)) return [];
      roots.add(entry.projectRootKey);
      entries.push({ projectRootKey: entry.projectRootKey, repositoryRoot: entry.repositoryRoot });
    }
    return entries;
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PATH_BYTES &&
    !value.includes("\0") &&
    new TextEncoder().encode(value).byteLength <= MAX_PATH_BYTES
  );
}
