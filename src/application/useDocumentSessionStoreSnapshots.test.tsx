// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentSessionDocumentLease,
  DocumentSessionOwnerLease,
} from "../domain/documentSession";
import { createWorkspaceEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorDocument } from "../domain/workspace";
import { createDocumentSaveIdentity, type DocumentSaveIdentity } from "./documentSaveIdentity";
import { DocumentSessionStore } from "./documentSessionStore";
import {
  useDocumentSessionDocumentSnapshot,
  useDocumentSessionOwnerSnapshot,
} from "./useDocumentSessionStoreSnapshots";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";
const OWNER_A = createWorkspaceEditorSessionOwnerKey(ROOT_A);
const OWNER_B = createWorkspaceEditorSessionOwnerKey(ROOT_B);
const roots = new Set<Root>();

afterEach(() => {
  for (const root of [...roots]) {
    act(() => root.unmount());
    roots.delete(root);
  }
});

describe("document session store snapshots", () => {
  it.each([1, 2, 4])(
    "renders only %i panes subscribed to a 1 MiB document across 100 edits",
    (paneCount) => {
      const store = new DocumentSessionStore();
      const owner = activate(store, OWNER_A, ROOT_A);
      const megabyte = "x".repeat(1024 * 1024);
      const target = open(store, owner, "src/large.ts", megabyte);
      const unrelated = open(store, owner, "src/unrelated.ts", "unrelated");
      const paneRenders = Array.from({ length: paneCount }, () => 0);
      let unrelatedRenders = 0;

      function Pane({ index }: { readonly index: number }) {
        useDocumentSessionDocumentSnapshot(store, target);
        paneRenders[index] += 1;
        return null;
      }
      function UnrelatedPane() {
        useDocumentSessionDocumentSnapshot(store, unrelated);
        unrelatedRenders += 1;
        return null;
      }

      const root = trackedRoot();
      act(() => {
        root.render(
          <>
            {paneRenders.map((_, index) => (
              <Pane index={index} key={index} />
            ))}
            <UnrelatedPane />
          </>,
        );
      });

      for (let index = 0; index < 100; index += 1) {
        const suffix = index.toString().padStart(3, "0");
        act(() => {
          const result = store.edit(
            store.capture(target)!,
            `${megabyte.slice(0, -suffix.length)}${suffix}`,
          );
          expect(result.status).toBe("applied");
        });
      }

      expect(paneRenders).toEqual(Array.from({ length: paneCount }, () => 101));
      expect(unrelatedRenders).toBe(1);
    },
  );

  it("renders owner metadata only for topology and clean-to-dirty transitions", () => {
    const store = new DocumentSessionStore();
    const owner = activate(store, OWNER_A, ROOT_A);
    const document = open(store, owner, "src/a.ts", "base");
    let renders = 0;
    let dirtyCount = -1;
    let documentCount = -1;

    function OwnerMetadata() {
      const snapshot = useDocumentSessionOwnerSnapshot(store, owner);
      renders += 1;
      if (snapshot.status === "active") {
        dirtyCount = snapshot.dirtyCount;
        documentCount = snapshot.documentCount;
      }
      return null;
    }

    const root = trackedRoot();
    act(() => root.render(<OwnerMetadata />));
    expect(renders).toBe(1);

    act(() => {
      open(store, owner, "src/b.ts", "b");
    });
    expect({ dirtyCount, documentCount, renders }).toEqual({
      dirtyCount: 0,
      documentCount: 2,
      renders: 2,
    });

    act(() => {
      store.edit(store.capture(document)!, "dirty");
    });
    expect({ dirtyCount, documentCount, renders }).toEqual({
      dirtyCount: 1,
      documentCount: 2,
      renders: 3,
    });

    for (let index = 0; index < 10; index += 1) {
      act(() => {
        store.edit(store.capture(document)!, `dirty-${index}`);
      });
    }
    expect(renders).toBe(3);

    const permit = store.issueSave(store.capture(document)!)!;
    act(() => {
      store.acknowledgeSave(permit, { revision: null });
    });
    expect({ dirtyCount, documentCount, renders }).toEqual({
      dirtyCount: 0,
      documentCount: 2,
      renders: 4,
    });
  });

  it("invalidates a retired lease and cleans up the exact subscription", () => {
    const store = new DocumentSessionStore();
    const ownerA = activate(store, OWNER_A, ROOT_A);
    const document = open(store, ownerA, "src/a.ts", "a");
    const originalSubscribe = store.subscribeDocument.bind(store);
    const cleanup = vi.fn();
    vi.spyOn(store, "subscribeDocument").mockImplementation((lease, listener) => {
      const unsubscribe = originalSubscribe(lease, listener);
      return () => {
        cleanup();
        unsubscribe();
      };
    });
    const statuses: string[] = [];
    let selectedDocument = document;

    function Pane() {
      const snapshot = useDocumentSessionDocumentSnapshot(store, selectedDocument);
      statuses.push(snapshot.status);
      return null;
    }

    const root = trackedRoot();
    act(() => root.render(<Pane />));
    act(() => {
      activate(store, OWNER_B, ROOT_B);
    });
    expect(statuses).toEqual(["available", "unavailable"]);

    const nextOwnerA = activate(store, OWNER_A, ROOT_A);
    selectedDocument = store.resolve(nextOwnerA, identity(ROOT_A, "src/a.ts"))!;
    act(() => root.render(<Pane />));
    expect(statuses).toEqual(["available", "unavailable", "available"]);
    expect(cleanup).toHaveBeenCalledOnce();

    act(() => root.unmount());
    roots.delete(root);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("returns stable frozen unavailable snapshots without subscribing for null leases", () => {
    const store = new DocumentSessionStore();
    const documentSnapshots: object[] = [];
    const ownerSnapshots: object[] = [];
    const subscribeDocument = vi.spyOn(store, "subscribeDocument");
    const subscribeOwner = vi.spyOn(store, "subscribeOwner");

    function EmptySelectors() {
      documentSnapshots.push(useDocumentSessionDocumentSnapshot(store, null));
      ownerSnapshots.push(useDocumentSessionOwnerSnapshot(store, null));
      return null;
    }

    const root = trackedRoot();
    act(() => root.render(<EmptySelectors />));
    act(() => root.render(<EmptySelectors />));

    expect(documentSnapshots[1]).toBe(documentSnapshots[0]);
    expect(ownerSnapshots[1]).toBe(ownerSnapshots[0]);
    expect(Object.isFrozen(documentSnapshots[0])).toBe(true);
    expect(Object.isFrozen(ownerSnapshots[0])).toBe(true);
    expect(subscribeDocument).not.toHaveBeenCalled();
    expect(subscribeOwner).not.toHaveBeenCalled();
  });

  it("keeps retired A selectors unavailable under StrictMode until an exact new A lease is supplied", () => {
    const store = new DocumentSessionStore();
    const firstOwnerA = activate(store, OWNER_A, ROOT_A);
    const firstDocumentA = open(store, firstOwnerA, "src/a.ts", "first A");
    let selectedOwner = firstOwnerA;
    let selectedDocument = firstDocumentA;
    const observed: string[] = [];

    function Selectors() {
      const owner = useDocumentSessionOwnerSnapshot(store, selectedOwner);
      const document = useDocumentSessionDocumentSnapshot(store, selectedDocument);
      observed.push(`${owner.status}:${document.status}`);
      return null;
    }

    const root = trackedRoot();
    const render = () =>
      act(() =>
        root.render(
          <StrictMode>
            <Selectors />
          </StrictMode>,
        ),
      );
    render();
    act(() => {
      activate(store, OWNER_B, ROOT_B);
    });
    expect(observed[observed.length - 1]).toBe("unavailable:unavailable");
    const renderCountAfterRetirement = observed.length;

    let nextOwnerA!: DocumentSessionOwnerLease;
    act(() => {
      nextOwnerA = activate(store, OWNER_A, ROOT_A);
    });
    const nextDocumentA = store.resolve(nextOwnerA, identity(ROOT_A, "src/a.ts"))!;
    act(() => {
      store.edit(store.capture(nextDocumentA)!, "new A");
    });
    expect(observed).toHaveLength(renderCountAfterRetirement);

    selectedOwner = nextOwnerA;
    selectedDocument = nextDocumentA;
    render();
    expect(observed[observed.length - 1]).toBe("active:available");
  });
});

function trackedRoot(): Root {
  const root = createRoot(document.createElement("div"));
  roots.add(root);
  return root;
}

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
  const result = store.open(owner, seed(owner.rootPath, relativePath, content));
  if (result.status !== "opened") {
    throw new Error(`Document admission failed: ${result.reason}`);
  }
  return result.lease;
}

function seed(
  rootPath: string,
  relativePath: string,
  content: string,
): { readonly document: EditorDocument; readonly identity: DocumentSaveIdentity } {
  const pathSegments = relativePath.split("/");
  return {
    document: {
      content,
      language: "typescript",
      name: pathSegments[pathSegments.length - 1] ?? relativePath,
      path: `${rootPath}/${relativePath}`,
      savedContent: content,
    },
    identity: identity(rootPath, relativePath),
  };
}

function identity(rootPath: string, relativePath: string): DocumentSaveIdentity {
  const result = createDocumentSaveIdentity(rootPath, relativePath);
  if (!result) throw new Error("Invalid test identity");
  return result;
}
