import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_AGENT_MODEL_FAVORITES,
  nextAgentModelFavoritesRevision,
} from "../domain/agentSettings";

export { MAX_AGENT_MODEL_FAVORITES };

export interface AgentModelFavorites {
  readonly keys: ReadonlySet<string>;
  isFavorite(key: string): boolean;
  toggle(key: string): void;
}

export function toggleAgentModelFavorite(
  keys: ReadonlySet<string>,
  key: string,
  limit: number = MAX_AGENT_MODEL_FAVORITES,
): ReadonlySet<string> {
  if (keys.has(key)) {
    const next = new Set(keys);
    next.delete(key);
    return next;
  }
  if (keys.size >= limit) return keys;
  return new Set([...keys, key]);
}

export interface AgentModelFavoritesPersistence {
  readonly keys: ReadonlyArray<string>;
  readonly revision: number;
  save(keys: ReadonlyArray<string>, revision: number): Promise<void>;
}

interface FavoriteWrite {
  readonly keys: ReadonlyArray<string>;
  readonly revision: number;
}

export function useAgentModelFavorites(
  persistence: AgentModelFavoritesPersistence | null = null,
): AgentModelFavorites {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set(persistence?.keys ?? []));
  const keysRef = useRef(keys);
  const persistenceRef = useRef(persistence);
  const inFlightRef = useRef<FavoriteWrite | null>(null);
  const pendingRef = useRef<FavoriteWrite | null>(null);
  const failedRollbackRef = useRef<FavoriteWrite | null>(null);
  const revisionRef = useRef(persistence?.revision ?? 0);
  const authoritativeRef = useRef({
    keys: new Set(persistence?.keys ?? []),
    revision: persistence?.revision ?? 0,
  });
  const drainRef = useRef<() => void>(() => undefined);
  persistenceRef.current = persistence;

  useEffect(() => {
    if (persistence === null) return;
    const authoritative = new Set(persistence.keys);
    if (
      authoritativeRef.current.revision === persistence.revision &&
      sameKeys(authoritativeRef.current.keys, authoritative)
    ) {
      return;
    }
    const lowerRevision = persistence.revision < revisionRef.current;
    if (lowerRevision) {
      const failedRollback = failedRollbackRef.current;
      if (pendingRef.current !== null) return;
      if (failedRollback === null) return;
      if (failedRollback.revision !== persistence.revision) return;
      if (!sameKeys(new Set(failedRollback.keys), authoritative)) return;
      failedRollbackRef.current = null;
    }
    authoritativeRef.current = { keys: authoritative, revision: persistence.revision };
    const externalWins = persistence.revision >= revisionRef.current;
    if (externalWins) {
      pendingRef.current = null;
      failedRollbackRef.current = null;
    }
    revisionRef.current = persistence.revision;
    if (!sameKeys(keysRef.current, authoritative)) {
      keysRef.current = authoritative;
      setKeys(authoritative);
    }
    if (inFlightRef.current === null || !externalWins) return;
    if (
      inFlightRef.current.revision === persistence.revision &&
      sameKeys(new Set(inFlightRef.current.keys), authoritative)
    ) {
      return;
    }
    pendingRef.current = { keys: [...authoritative], revision: persistence.revision };
  }, [persistence]);

  const drain = useCallback((): void => {
    if (inFlightRef.current !== null) return;
    const next = pendingRef.current;
    const adapter = persistenceRef.current;
    if (next === null || adapter === null) return;
    pendingRef.current = null;
    inFlightRef.current = next;
    const currentPersistence = persistenceRef.current;
    const rollback = {
      keys: [...(currentPersistence?.keys ?? authoritativeRef.current.keys)],
      revision: currentPersistence?.revision ?? authoritativeRef.current.revision,
    };
    void adapter
      .save(next.keys, next.revision)
      .catch(() => {
        if (pendingRef.current !== null) return;
        failedRollbackRef.current = rollback;
        const current = persistenceRef.current;
        if (current === null) return;
        if (current.revision !== rollback.revision) return;
        const currentKeys = new Set(current.keys);
        if (!sameKeys(currentKeys, new Set(rollback.keys))) return;
        authoritativeRef.current = { keys: currentKeys, revision: current.revision };
        revisionRef.current = current.revision;
        failedRollbackRef.current = null;
        if (sameKeys(keysRef.current, currentKeys)) return;
        keysRef.current = currentKeys;
        setKeys(currentKeys);
      })
      .finally(() => {
        if (inFlightRef.current?.revision === next.revision) inFlightRef.current = null;
        drainRef.current();
      });
  }, []);
  drainRef.current = drain;

  const toggle = useCallback(
    (key: string) => {
      const next = toggleAgentModelFavorite(keysRef.current, key);
      if (next === keysRef.current) return;
      const adapter = persistenceRef.current;
      const revision =
        adapter === null ? null : nextAgentModelFavoritesRevision(revisionRef.current);
      if (adapter !== null && revision === null) return;
      failedRollbackRef.current = null;
      keysRef.current = next;
      setKeys(next);
      if (revision === null) return;
      revisionRef.current = revision;
      pendingRef.current = { keys: [...next], revision };
      drain();
    },
    [drain],
  );

  const isFavorite = useCallback((key: string) => keys.has(key), [keys]);

  return useMemo(() => ({ keys, isFavorite, toggle }), [isFavorite, keys, toggle]);
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}
