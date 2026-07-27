import { describe, expect, it } from "vitest";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { commitDiagnosticsOwnerCacheBatch } from "./diagnosticsOwnerCacheCoordinator";
import {
  DIAGNOSTICS_LIFECYCLE_MAX_OWNERS,
  DiagnosticsOwnerLifecycleStore,
} from "./diagnosticsOwnerLifecycleStore";

const diagnostic: LanguageServerDiagnostic = {
  character: 0,
  line: 0,
  message: "problem",
  severity: "error",
  source: "test",
};

describe("commitDiagnosticsOwnerCacheBatch", () => {
  it.each(["php", "typescript"] as const)(
    "keeps %s owner cache and ledger on the same exact lifecycle",
    (kind) => {
      const lifecycleStore = new DiagnosticsOwnerLifecycleStore();
      const cacheByOwner = {};
      const ownerKey = "workspace::owner-a";
      const lifecycleKey = `${kind}:${ownerKey}`;

      const result = commitDiagnosticsOwnerCacheBatch({
        cacheByOwner,
        lifecycleKey,
        lifecycleStore,
        ownerKey,
        updates: [
          {
            diagnostics: [diagnostic],
            path: "/workspace/file.ts",
            publishedCount: 1,
          },
        ],
      });

      expect(result?.receipt.retainedCount).toBe(1);
      expect(cacheByOwner).toEqual({
        [ownerKey]: { "/workspace/file.ts": [diagnostic] },
      });
      expect(lifecycleStore.ledger(lifecycleKey)?.publishedCount).toBe(1);
    },
  );

  it("fails closed without mutating cache when all owner slots are active", () => {
    const lifecycleStore = new DiagnosticsOwnerLifecycleStore();
    for (let index = 0; index < DIAGNOSTICS_LIFECYCLE_MAX_OWNERS; index += 1) {
      lifecycleStore.restore(`php:active-${index}`);
    }
    const cacheByOwner = {
      overflow: { "/workspace/existing.ts": [diagnostic] },
    };

    expect(
      commitDiagnosticsOwnerCacheBatch({
        cacheByOwner,
        lifecycleKey: "typescript:overflow",
        lifecycleStore,
        ownerKey: "overflow",
        updates: [
          {
            diagnostics: [],
            path: "/workspace/existing.ts",
            publishedCount: 0,
          },
        ],
      }),
    ).toBeNull();
    expect(cacheByOwner).toEqual({
      overflow: { "/workspace/existing.ts": [diagnostic] },
    });
  });
});
