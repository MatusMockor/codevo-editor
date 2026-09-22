import { useEffect, useState } from "react";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeModelManifest,
} from "../domain/claudeModelCatalog";
import type { ClaudeModelCatalogGateway } from "./claudeModelCatalogGateway";

// The backend owns network TTL, retry backoff, validation and persistent cache.
const CATALOG_CHECK_INTERVAL_MS = 60_000;

export function useClaudeModelCatalog(gateway: ClaudeModelCatalogGateway): ClaudeModelManifest {
  const [catalog, setCatalog] = useState(BUNDLED_CLAUDE_MODEL_MANIFEST);
  useEffect(() => {
    let owned = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    setCatalog(BUNDLED_CLAUDE_MODEL_MANIFEST);
    const publish = (next: ClaudeModelManifest): void => {
      if (!owned) return;
      setCatalog((previous) => (next.updatedAt >= previous.updatedAt ? next : previous));
    };
    const refresh = async (): Promise<void> => {
      try {
        const next = await gateway.read();
        publish(next);
      } catch {
        // A failed refresh must preserve the last usable catalog.
      }
      if (owned) timer = setTimeout(() => void refresh(), CATALOG_CHECK_INTERVAL_MS);
    };
    const start = async (): Promise<void> => {
      try {
        // Subscribe before reading: background cache/remote completion cannot race us.
        const stop = await gateway.subscribe?.(publish);
        if (!owned) {
          stop?.();
          return;
        }
        unsubscribe = stop;
      } catch {
        // Polling remains available when native event registration fails.
      }
      if (owned) void refresh();
    };
    void start();
    return () => {
      owned = false;
      unsubscribe?.();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [gateway]);
  return catalog;
}
