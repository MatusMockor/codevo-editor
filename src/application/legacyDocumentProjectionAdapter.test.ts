import { describe, expect, it, vi } from "vitest";
import { createWorkspaceEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type {
  DocumentSessionDocumentLease,
  DocumentSessionOwnerLease,
  DocumentSessionStoreLimits,
} from "../domain/documentSession";
import type { EditorDocument } from "../domain/workspace";
import { createDocumentSaveIdentity } from "./documentSaveIdentity";
import { DocumentSessionStore } from "./documentSessionStore";
import { LegacyDocumentProjectionAdapter } from "./legacyDocumentProjectionAdapter";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";
const OWNER_A = createWorkspaceEditorSessionOwnerKey(ROOT_A);
const OWNER_B = createWorkspaceEditorSessionOwnerKey(ROOT_B);

describe("LegacyDocumentProjectionAdapter", () => {
  it("publishes cached deeply read-only projections backed by accepted store snapshots", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const adapter = new LegacyDocumentProjectionAdapter(store, owner);
    const document = seed(ROOT_A, "src/a.ts", "base");

    const result = adapter.reconcile({ [document.path]: document });
    expect(result.status).toBe("applied");
    const first = adapter.getSnapshot();
    expect(Reflect.set(first, "foreign", document)).toBe(false);
    expect(Reflect.deleteProperty(first, document.path)).toBe(false);
    expect(() => Object.freeze(first)).toThrow(TypeError);
    expect(() => Object.preventExtensions(first)).toThrow(TypeError);
    expect(Object.isExtensible(first)).toBe(true);
    expect(Object.keys(first)).toEqual([document.path]);
    expect(Object.isFrozen(first[document.path])).toBe(true);
    expect(Object.isFrozen(first[document.path]?.revision ?? Object.freeze({}))).toBe(true);
    expect(adapter.reconcile({ [document.path]: document }).status).toBe("applied");
    expect(adapter.getSnapshot()).toBe(first);
  });

  it("rejects accessor-backed legacy records without invoking user getters", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const adapter = new LegacyDocumentProjectionAdapter(store, owner);
    const getter = vi.fn(() => seed(ROOT_A, "a.ts", "a"));
    const proposed = {};
    Object.defineProperty(proposed, `${ROOT_A}/a.ts`, {
      enumerable: true,
      get: getter,
    });

    expect(adapter.reconcile(proposed as Readonly<Record<string, EditorDocument>>)).toEqual({
      reason: "invalid-document",
      status: "rejected",
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("applies an external clean replacement atomically and publishes the projection before observers", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const adapter = new LegacyDocumentProjectionAdapter(store, owner);
    const first = seed(ROOT_A, "src/a.ts", "base");
    const second = seed(ROOT_A, "src/b.ts", "second");
    adapter.reconcile({ [first.path]: first, [second.path]: second });
    const firstLease = resolve(store, owner, "src/a.ts");
    const secondLease = resolve(store, owner, "src/b.ts");
    const observations: Array<readonly [string, string]> = [];
    store.subscribeDocument(firstLease, () => {
      observations.push([
        adapter.getSnapshot()[first.path]?.content ?? "missing",
        adapter.getSnapshot()[second.path]?.content ?? "missing",
      ]);
    });
    store.subscribeDocument(secondLease, () => {
      observations.push([
        adapter.getSnapshot()[first.path]?.content ?? "missing",
        adapter.getSnapshot()[second.path]?.content ?? "missing",
      ]);
    });

    const result = adapter.reconcile({
      [first.path]: {
        ...first,
        content: "disk-a",
        revision: revision(10, 6),
        savedContent: "disk-a",
      },
      [second.path]: {
        ...second,
        content: "disk-b",
        revision: revision(11, 6),
        savedContent: "disk-b",
      },
    });

    expect(result.status).toBe("applied");
    expect(observations).toEqual([
      ["disk-a", "disk-b"],
      ["disk-a", "disk-b"],
    ]);
    expect(available(store, firstLease).document.content).toBe("disk-a");
    expect(available(store, secondLease).document.content).toBe("disk-b");
  });

  it("rolls back the complete projection and store when one document exceeds the batch budget", () => {
    const store = new DocumentSessionStore(limits({ maxRetainedEstimatedBytes: 1_000 }));
    const owner = activate(store, OWNER_A, ROOT_A);
    const adapter = new LegacyDocumentProjectionAdapter(store, owner);
    const first = seed(ROOT_A, "a.ts", "a");
    const second = seed(ROOT_A, "b.ts", "b");
    adapter.reconcile({ [first.path]: first, [second.path]: second });
    const beforeProjection = adapter.getSnapshot();
    const firstLease = resolve(store, owner, "a.ts");
    const secondLease = resolve(store, owner, "b.ts");
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    store.subscribeDocument(firstLease, firstListener);
    store.subscribeDocument(secondLease, secondListener);

    expect(
      adapter.reconcile({
        [first.path]: { ...first, content: "accepted-alone" },
        [second.path]: { ...second, content: "x".repeat(1_000) },
      }),
    ).toEqual({ reason: "content-budget", status: "rejected" });

    expect(adapter.getSnapshot()).toBe(beforeProjection);
    expect(available(store, firstLease).document.content).toBe("a");
    expect(available(store, secondLease).document.content).toBe("b");
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();
  });

  it("updates one live projection slot for 100 one-megabyte edits and only notifies exact panes", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const adapter = new LegacyDocumentProjectionAdapter(store, owner);
    const megabyte = "x".repeat(1024 * 1024);
    const target = seed(ROOT_A, "large.ts", megabyte);
    const unrelated = seed(ROOT_A, "unrelated.ts", "unrelated");
    adapter.reconcile({
      [target.path]: target,
      [unrelated.path]: unrelated,
    });
    const projection = adapter.getSnapshot();
    const unrelatedDocument = projection[unrelated.path];
    const targetLease = resolve(store, owner, "large.ts");
    const unrelatedLease = resolve(store, owner, "unrelated.ts");
    const paneListeners = Array.from({ length: 4 }, () => vi.fn());
    const unrelatedListener = vi.fn();
    for (const listener of paneListeners) {
      store.subscribeDocument(targetLease, listener);
    }
    store.subscribeDocument(unrelatedLease, unrelatedListener);

    for (let index = 0; index < 100; index += 1) {
      const suffix = index.toString().padStart(3, "0");
      expect(
        store.edit(store.capture(targetLease)!, `${megabyte.slice(0, -suffix.length)}${suffix}`)
          .status,
      ).toBe("applied");
    }

    expect(adapter.getSnapshot()).toBe(projection);
    expect(adapter.getSnapshot()[unrelated.path]).toBe(unrelatedDocument);
    expect(adapter.getSnapshot()[target.path]?.content.endsWith("099")).toBe(true);
    for (const listener of paneListeners) {
      expect(listener).toHaveBeenCalledTimes(100);
    }
    expect(unrelatedListener).not.toHaveBeenCalled();
  });

  it("rejects save metadata replacement while an exact save permit is in flight", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const adapter = new LegacyDocumentProjectionAdapter(store, owner);
    const document = seed(ROOT_A, "src/a.ts", "base");
    adapter.reconcile({ [document.path]: document });
    const lease = resolve(store, owner, "src/a.ts");
    store.edit(store.capture(lease)!, "written");
    const permit = store.issueSave(store.capture(lease)!)!;
    const beforeProjection = adapter.getSnapshot();

    expect(
      adapter.reconcile({
        [document.path]: {
          ...document,
          content: "written",
          revision: revision(20, 7),
          savedContent: "written",
        },
      }),
    ).toEqual({ reason: "save-in-flight", status: "rejected" });
    expect(adapter.getSnapshot()).toBe(beforeProjection);
    expect(available(store, lease).document.savedContent).toBe("base");

    expect(
      store.acknowledgeSave(permit, {
        revision: revision(20, 7),
      }).status,
    ).toBe("applied");
  });

  it("requires an exact explicit discard authority before removing a dirty document", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const adapter = new LegacyDocumentProjectionAdapter(store, owner);
    const document = seed(ROOT_A, "dirty.ts", "base");
    adapter.reconcile({ [document.path]: document });
    const lease = resolve(store, owner, "dirty.ts");
    store.edit(store.capture(lease)!, "dirty");
    const projection = adapter.getSnapshot();

    expect(adapter.reconcile({})).toEqual({
      reason: "dirty-document",
      status: "rejected",
    });
    expect(adapter.getSnapshot()).toBe(projection);
    expect(adapter.getSnapshot()[document.path]?.content).toBe("dirty");

    expect(adapter.reconcile({}, { discardDirtyPaths: [document.path] }).status).toBe("applied");
    expect(Object.keys(adapter.getSnapshot())).toEqual([]);
    expect(store.getDocumentSnapshot(lease)).toEqual({
      status: "unavailable",
    });
  });

  it("rejects a stale direct multi-document CAS without partially applying it", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const firstLease = open(store, owner, "a.ts", "a");
    const secondLease = open(store, owner, "b.ts", "b");
    const staleFirst = store.capture(firstLease)!;
    const secondReceipt = store.capture(secondLease)!;
    store.edit(staleFirst, "newer");
    const ownerSnapshot = store.getOwnerSnapshot(owner);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    store.subscribeDocument(firstLease, firstListener);
    store.subscribeDocument(secondLease, secondListener);
    const projection = store.createCompatibilityProjection(owner)!;

    expect(
      store.reconcileCompatibilityProjection(owner, projection.lease, {
        documents: [
          {
            document: { ...seed(ROOT_A, "a.ts", "a"), content: "late-a" },
            identity: identity(ROOT_A, "a.ts"),
            receipt: staleFirst,
          },
          {
            document: { ...seed(ROOT_A, "b.ts", "b"), content: "next-b" },
            identity: identity(ROOT_A, "b.ts"),
            receipt: secondReceipt,
          },
        ],
        ownerSnapshot,
        removals: [],
      }),
    ).toEqual({ reason: "stale-receipt", status: "rejected" });
    expect(available(store, firstLease).document.content).toBe("newer");
    expect(available(store, secondLease).document.content).toBe("b");
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();
  });

  it("fails closed across A-B-A and rejects reentrant projection writes", () => {
    const store = new DocumentSessionStore();
    const firstA = activate(store, OWNER_A, ROOT_A);
    const staleAdapter = new LegacyDocumentProjectionAdapter(store, firstA);
    const first = seed(ROOT_A, "a.ts", "a");
    staleAdapter.reconcile({ [first.path]: first });

    activate(store, OWNER_B, ROOT_B);
    const nextA = activate(store, OWNER_A, ROOT_A);
    expect(
      staleAdapter.reconcile({
        [first.path]: { ...first, content: "stale" },
      }),
    ).toEqual({ reason: "invalid-owner", status: "rejected" });
    expect(Object.keys(staleAdapter.getSnapshot())).toEqual([]);
    expect(available(store, resolve(store, nextA, "a.ts")).document.content).toBe("a");

    const adapter = new LegacyDocumentProjectionAdapter(store, nextA);
    adapter.reconcile({ [first.path]: first });
    const lease = resolve(store, nextA, "a.ts");
    let reentrant: ReturnType<LegacyDocumentProjectionAdapter["reconcile"]> | undefined;
    store.subscribeDocument(lease, () => {
      reentrant = adapter.reconcile({
        [first.path]: { ...first, content: "reentrant" },
      });
    });
    adapter.reconcile({
      [first.path]: { ...first, content: "outer" },
    });

    expect(reentrant).toEqual({
      reason: "reentrant-operation",
      status: "rejected",
    });
    expect(adapter.getSnapshot()[first.path]?.content).toBe("outer");
  });

  it("settles the committed batch and continues publication when one observer throws", () => {
    const subscriberErrors: unknown[] = [];
    const store = new DocumentSessionStore(undefined, (error) => {
      subscriberErrors.push(error);
    });
    const owner = activate(store, OWNER_A, ROOT_A);
    const adapter = new LegacyDocumentProjectionAdapter(store, owner);
    const document = seed(ROOT_A, "a.ts", "a");
    adapter.reconcile({ [document.path]: document });
    const lease = resolve(store, owner, "a.ts");
    const laterListener = vi.fn();
    store.subscribeDocument(lease, () => {
      throw new Error("observer failed");
    });
    store.subscribeDocument(lease, laterListener);

    expect(
      adapter.reconcile({
        [document.path]: { ...document, content: "committed" },
      }).status,
    ).toBe("applied");
    expect(subscriberErrors).toHaveLength(1);
    expect(laterListener).toHaveBeenCalledTimes(1);
    expect(adapter.getSnapshot()[document.path]?.content).toBe("committed");
    expect(available(store, lease).document.content).toBe("committed");
  });
});

function activate(
  store: DocumentSessionStore,
  ownerKey: typeof OWNER_A,
  rootPath: string,
): DocumentSessionOwnerLease {
  const result = store.activateOwner({
    canonicalRoot: rootPath,
    ownerKey,
    rootPath,
    workspaceId: rootPath,
  });
  if (result.status !== "activated") {
    throw new Error(`Owner admission failed: ${result.reason}`);
  }
  return result.lease;
}

function open(
  store: DocumentSessionStore,
  owner: DocumentSessionOwnerLease,
  relativePath: string,
  content: string,
): DocumentSessionDocumentLease {
  const result = store.open(owner, {
    document: seed(owner.rootPath, relativePath, content),
    identity: identity(owner.canonicalRoot, relativePath),
  });
  if (result.status !== "opened") {
    throw new Error(`Document admission failed: ${result.reason}`);
  }
  return result.lease;
}

function resolve(
  store: DocumentSessionStore,
  owner: DocumentSessionOwnerLease,
  relativePath: string,
): DocumentSessionDocumentLease {
  const lease = store.resolve(owner, identity(owner.canonicalRoot, relativePath));
  if (!lease) {
    throw new Error("Expected retained document.");
  }
  return lease;
}

function seed(rootPath: string, relativePath: string, content: string): EditorDocument {
  const path = `${rootPath}/${relativePath}`;
  return {
    content,
    language: "typescript",
    name: relativePath.split("/").slice(-1)[0] ?? relativePath,
    path,
    savedContent: content,
  };
}

function revision(modifiedNanoseconds: number, size: number) {
  return {
    contentHash: `hash-${modifiedNanoseconds}`,
    device: "1",
    inode: "2",
    modifiedNanoseconds,
    modifiedSeconds: 100,
    size,
  };
}

function identity(rootPath: string, relativePath: string) {
  const result = createDocumentSaveIdentity(rootPath, relativePath);
  if (!result) {
    throw new Error("Invalid identity.");
  }
  return result;
}

function available(store: DocumentSessionStore, lease: DocumentSessionDocumentLease) {
  const snapshot = store.getDocumentSnapshot(lease);
  if (snapshot.status !== "available") {
    throw new Error("Expected available document.");
  }
  return snapshot;
}

function limits(overrides: Partial<DocumentSessionStoreLimits>): DocumentSessionStoreLimits {
  return {
    maxDocumentsPerOwner: 10,
    maxOwners: 10,
    maxRetainedDocuments: 10,
    maxRetainedEstimatedBytes: 1_000_000,
    ...overrides,
  };
}
