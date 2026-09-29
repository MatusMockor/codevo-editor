import { useEffect, useState } from "react";
import { BUNDLED_CODEX_MODEL_CATALOG, type CodexModelCatalog } from "../domain/codexModelCatalog";
import type { CodexModelCatalogGateway } from "./codexModelCatalogGateway";

// The backend owns probe TTL, retry backoff, provider-generation ownership and validation.
const CATALOG_CHECK_INTERVAL_MS = 60_000;

export function useCodexModelCatalog(gateway: CodexModelCatalogGateway): CodexModelCatalog {
  const [catalog, setCatalog] = useState(BUNDLED_CODEX_MODEL_CATALOG);
  useEffect(() => {
    let owned = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    setCatalog(BUNDLED_CODEX_MODEL_CATALOG);
    const publish = (next: CodexModelCatalog): void => {
      if (!owned) return;
      setCatalog((previous) => (next.revision > previous.revision ? next : previous));
    };
    const refresh = async (): Promise<void> => {
      try {
        publish(await gateway.read());
      } catch {
        // A failed refresh must preserve the last usable catalog.
      }
      if (owned) timer = setTimeout(() => void refresh(), CATALOG_CHECK_INTERVAL_MS);
    };
    const start = async (): Promise<void> => {
      try {
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
