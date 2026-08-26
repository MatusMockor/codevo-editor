import { useCallback, useMemo, useState } from "react";

export const MAX_AGENT_MODEL_FAVORITES = 32;

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

export function useAgentModelFavorites(): AgentModelFavorites {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((key: string) => {
    setKeys((current) => toggleAgentModelFavorite(current, key));
  }, []);

  const isFavorite = useCallback((key: string) => keys.has(key), [keys]);

  return useMemo(() => ({ keys, isFavorite, toggle }), [isFavorite, keys, toggle]);
}
