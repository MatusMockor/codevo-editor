import { describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_LIFECYCLE_MAX_OWNERS,
  DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER,
  DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_RETAINED_UTF8_BYTES,
  DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_URI_STATES,
  DiagnosticsOwnerLifecycleStore,
} from "./diagnosticsOwnerLifecycleStore";

describe("DiagnosticsOwnerLifecycleStore", () => {
  it("bounds URI receipts and makes evicted async publications fail closed", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    expect(store.restore("php:owner-a")).toBe(true);
    const first = store.nextPublication("php:owner-a", "file:///first.php");
    expect(first).not.toBeNull();

    for (
      let index = 0;
      index < DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER + 5;
      index += 1
    ) {
      store.nextPublication("php:owner-a", `file:///file-${index}.php`);
    }

    expect(store.publicationUriCount("php:owner-a")).toBe(
      DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER,
    );
    expect(store.isPublicationCurrent("php:owner-a", "file:///first.php", first!)).toBe(false);
  });

  it("shares the URI budget with applied versions and removes evicted sink entries", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    const sink: Record<string, number> = {};
    store.restore("typescript:owner-a");

    for (
      let index = 0;
      index < DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER + 1;
      index += 1
    ) {
      store.recordAppliedVersion("typescript:owner-a", `file:///file-${index}.ts`, index, () => {
        delete sink[`owner-a\u0000file:///file-${index}.ts`];
      });
      sink[`owner-a\u0000file:///file-${index}.ts`] = index;
    }

    expect(store.publicationUriCount("typescript:owner-a")).toBe(
      DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER,
    );
    expect(sink["owner-a\u0000file:///file-0.ts"]).toBeUndefined();
    expect(Object.keys(sink)).toHaveLength(DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER);
    expect(store.canAcceptVersion("typescript:owner-a", "file:///never-tracked.ts")).toBe(false);
    expect(store.canAcceptVersion("typescript:owner-a", "file:///file-0.ts")).toBe(false);
    expect(store.appliedVersion("typescript:owner-a", "file:///file-0.ts")).toBeUndefined();
    expect(store.canAcceptVersion("typescript:owner-a", "file:///file-1.ts")).toBe(true);

    store.close("typescript:owner-a");
    expect(sink).toEqual({});
  });

  it("keeps A → B → A generations distinct after exact owner teardown", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    store.restore("typescript:owner-a");
    const firstA = store.revision("typescript:owner-a");
    store.restore("typescript:owner-b");
    const ownerB = store.revision("typescript:owner-b");

    store.close("typescript:owner-a");
    store.restore("typescript:owner-a");
    const secondA = store.revision("typescript:owner-a");

    expect(secondA).not.toBe(firstA);
    expect(ownerB).not.toBe(secondA);
    expect(store.isCurrent("typescript:owner-a", firstA!)).toBe(false);
    expect(store.isCurrent("typescript:owner-a", secondA!)).toBe(true);
  });

  it("clears exact owner receipts and ledgers on close", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    store.restore("php:owner");
    store.setLedger("php:owner", {
      publishedCount: 1,
      publishedCountByPath: { "/workspace/a.php": 1 },
      untrackedPublishedCount: 0,
    });
    const publication = store.nextPublication("php:owner", "file:///workspace/a.php");

    store.close("php:owner");

    expect(store.ledger("php:owner")).toBeUndefined();
    expect(store.isPublicationCurrent("php:owner", "file:///workspace/a.php", publication!)).toBe(
      false,
    );
    expect(store.publicationUriCount("php:owner")).toBe(0);
  });

  it("bounds owners and rejects generations evicted with an old owner", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    store.restore("php:oldest");
    const oldestGeneration = store.revision("php:oldest");
    store.close("php:oldest");
    for (let index = 0; index < DIAGNOSTICS_LIFECYCLE_MAX_OWNERS; index += 1) {
      store.restore(`php:owner-${index}`);
    }

    expect(store.ownerCount()).toBe(DIAGNOSTICS_LIFECYCLE_MAX_OWNERS);
    expect(store.isCurrent("php:oldest", oldestGeneration!)).toBe(false);
  });

  it("fails closed instead of evicting an active owner at capacity", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    for (let index = 0; index < DIAGNOSTICS_LIFECYCLE_MAX_OWNERS; index += 1) {
      expect(store.restore(`php:active-${index}`)).toBe(true);
    }
    const oldestGeneration = store.revision("php:active-0");

    expect(store.restore("php:overflow")).toBe(false);
    expect(store.capture("php:overflow")).toBeNull();
    expect(store.ownerCount()).toBe(DIAGNOSTICS_LIFECYCLE_MAX_OWNERS);
    expect(store.isCurrent("php:active-0", oldestGeneration!)).toBe(true);

    store.close("php:active-0");
    expect(store.restore("php:overflow")).toBe(true);
    expect(store.revision("php:overflow")).not.toBeNull();
    expect(store.isCurrent("php:active-0", oldestGeneration!)).toBe(false);
  });

  it("enforces the aggregate retained-byte budget without evicting active authority", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    const perOwnerBytes = DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_RETAINED_UTF8_BYTES / 4;
    const ledger = {
      publishedCount: 1,
      publishedCountByPath: { "/workspace/file.ts": 1 },
      retainedUtf8Bytes: perOwnerBytes,
      retainedUtf8BytesByPath: {
        "/workspace/file.ts": perOwnerBytes - 2,
      },
      untrackedPublishedCount: 0,
    };
    for (let index = 0; index < 4; index += 1) {
      store.restore(`php:owner-${index}`);
      expect(store.setLedger(`php:owner-${index}`, ledger)).toBe(true);
    }
    const firstGeneration = store.revision("php:owner-0");
    store.restore("php:overflow");

    expect(
      store.setLedger("php:overflow", {
        ...ledger,
        retainedUtf8Bytes: 1,
      }),
    ).toBe(false);
    expect(store.isCurrent("php:owner-0", firstGeneration!)).toBe(true);
    expect(store.retainedUtf8Bytes()).toBe(DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_RETAINED_UTF8_BYTES);

    store.close("php:owner-0");
    expect(store.setLedger("php:overflow", ledger)).toBe(true);
    expect(store.isCurrent("php:owner-0", firstGeneration!)).toBe(false);
  });

  it("enforces the aggregate URI-state budget across owners", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    const ownerCount =
      DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_URI_STATES /
      DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER;
    for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex += 1) {
      const ownerKey = `typescript:owner-${ownerIndex}`;
      store.restore(ownerKey);
      for (
        let uriIndex = 0;
        uriIndex < DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER;
        uriIndex += 1
      ) {
        expect(
          store.nextPublication(ownerKey, `file:///owner-${ownerIndex}/file-${uriIndex}.ts`),
        ).not.toBeNull();
      }
    }
    store.restore("typescript:overflow");

    expect(store.uriStateCount()).toBe(DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_URI_STATES);
    expect(store.nextPublication("typescript:overflow", "file:///overflow.ts")).toBeNull();

    store.close("typescript:owner-0");
    expect(store.nextPublication("typescript:overflow", "file:///overflow.ts")).not.toBeNull();
  });

  it("keeps revision reads side-effect free and does not reopen a closed owner", () => {
    const store = new DiagnosticsOwnerLifecycleStore();
    store.restore("php:owner");
    const generation = store.revision("php:owner");
    store.close("php:owner");

    expect(store.revision("php:owner")).toBeNull();
    expect(store.isClosed("php:owner")).toBe(true);
    expect(store.isCurrent("php:owner", generation!)).toBe(false);
  });
});
