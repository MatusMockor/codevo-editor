// @vitest-environment jsdom

import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import {
  EditorCursorStore,
  MAX_EDITOR_CURSOR_ACTIVE_SUBSCRIBERS,
  MAX_EDITOR_CURSOR_GROUP_SUBSCRIBERS,
  type EditorCursorLease,
  type EditorCursorStorePort,
} from "./editorCursorStore";

const ownerA = createLegacyEditorSessionOwnerKey("/workspace-a");
const ownerB = createLegacyEditorSessionOwnerKey("/workspace-b");

function activate(
  store: EditorCursorStore,
  ownerKey = ownerA,
  groupId = "group-1",
  documentPath = "/workspace-a/src/index.ts",
): EditorCursorLease {
  const lease = store.activate({ documentPath, groupId, ownerKey });
  if (!lease) throw new Error("Expected cursor authority activation");
  return lease;
}

describe("EditorCursorStore", () => {
  it("rejects stale A-B-A events even when the path and group are reused", () => {
    const store = new EditorCursorStore();
    const firstA = activate(store);
    const b = activate(store, ownerB, "group-1", "/workspace-b/src/index.ts");
    const secondA = activate(store);

    expect(secondA.generation).toBeGreaterThan(firstA.generation);
    expect(store.publish(firstA, { column: 90, lineNumber: 90 })).toBe(false);
    expect(store.publish(b, { column: 80, lineNumber: 80 })).toBe(false);
    expect(store.publish(secondA, { column: 7, lineNumber: 12 })).toBe(true);
    expect(store.getActiveSnapshot()).toMatchObject({
      authority: secondA,
      position: { column: 7, lineNumber: 12 },
      status: "available",
      version: 1,
    });
  });

  it("issues a fresh incarnation when Monaco remounts for the same authority", () => {
    const store = new EditorCursorStore();
    const first = activate(store);
    const remounted = activate(store);

    expect(remounted.generation).toBeGreaterThan(first.generation);
    expect(store.publish(first, { column: 90, lineNumber: 90 })).toBe(false);
    expect(store.publish(remounted, { column: 3, lineNumber: 2 })).toBe(true);
    expect(store.ensureActive(remounted)).toBe(remounted);
  });

  it("notifies only the exact group lease and the active projection", () => {
    const store = new EditorCursorStore();
    const first = activate(store);
    const firstListener = vi.fn();
    const activeListener = vi.fn();
    store.subscribeGroup(first, firstListener);
    store.subscribeActive(activeListener);

    expect(store.publish(first, { column: 2, lineNumber: 3 })).toBe(true);
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(activeListener).toHaveBeenCalledTimes(1);

    const second = activate(store, ownerA, "group-2", "/workspace-a/src/other.ts");
    expect(activeListener).toHaveBeenCalledTimes(2);
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(store.publish(first, { column: 4, lineNumber: 5 })).toBe(false);
    expect(store.publish(second, { column: 6, lineNumber: 7 })).toBe(true);
    expect(firstListener).toHaveBeenCalledTimes(1);
  });

  it("bounds retained group snapshots and invalidates an evicted lease", () => {
    const store = new EditorCursorStore(2);
    const first = activate(store, ownerA, "group-1", "/workspace-a/one.ts");
    activate(store, ownerA, "group-2", "/workspace-a/two.ts");
    const third = activate(store, ownerA, "group-3", "/workspace-a/three.ts");

    expect(store.getSnapshot(first)).toEqual({ status: "unavailable" });
    expect(store.getSnapshot(third)).toMatchObject({
      authority: third,
      status: "available",
    });
  });

  it("deactivates only the exact active lease when the last tab closes", () => {
    const store = new EditorCursorStore();
    const first = activate(store);
    const second = activate(store, ownerA, "group-2", "/workspace-a/src/other.ts");

    expect(store.deactivate(first)).toBe(false);
    expect(store.deactivate(second)).toBe(true);
    expect(store.getActiveSnapshot()).toEqual({ status: "unavailable" });
    expect(store.publish(second, { column: 1, lineNumber: 1 })).toBe(false);
  });

  it("fails closed for invalid, duplicate, and reentrant publications", () => {
    const store = new EditorCursorStore();
    const lease = activate(store);
    const reentrantResults: boolean[] = [];
    store.subscribeActive(() => {
      reentrantResults.push(store.publish(lease, { column: 3, lineNumber: 3 }));
    });

    expect(store.publish(lease, { column: 0, lineNumber: 1 })).toBe(false);
    expect(store.publish(lease, { column: 2, lineNumber: 2 })).toBe(true);
    expect(reentrantResults).toEqual([false]);
    const snapshot = store.getActiveSnapshot();
    expect(store.publish(lease, { column: 2, lineNumber: 2 })).toBe(true);
    expect(store.getActiveSnapshot()).toBe(snapshot);
  });

  it("bounds listener retention and admits replacements after unsubscribe", () => {
    const store = new EditorCursorStore();
    const lease = activate(store);
    const activeListeners = Array.from({ length: MAX_EDITOR_CURSOR_ACTIVE_SUBSCRIBERS + 1 }, () =>
      vi.fn(),
    );
    const groupListeners = Array.from({ length: MAX_EDITOR_CURSOR_GROUP_SUBSCRIBERS + 1 }, () =>
      vi.fn(),
    );
    const activeUnsubscribers = activeListeners.map((listener) => store.subscribeActive(listener));
    const groupUnsubscribers = groupListeners.map((listener) =>
      store.subscribeGroup(lease, listener),
    );

    store.publish(lease, { column: 2, lineNumber: 2 });
    expect(activeListeners[activeListeners.length - 1]).not.toHaveBeenCalled();
    expect(groupListeners[groupListeners.length - 1]).not.toHaveBeenCalled();

    activeUnsubscribers[0]?.();
    groupUnsubscribers[0]?.();
    const replacementActive = vi.fn();
    const replacementGroup = vi.fn();
    store.subscribeActive(replacementActive);
    store.subscribeGroup(lease, replacementGroup);
    store.publish(lease, { column: 3, lineNumber: 3 });
    expect(replacementActive).toHaveBeenCalledTimes(1);
    expect(replacementGroup).toHaveBeenCalledTimes(1);
  });

  it("isolates throwing subscribers and settles every projection", () => {
    const reported = vi.fn();
    const store = new EditorCursorStore(16, reported);
    const lease = activate(store);
    const groupAfterThrow = vi.fn();
    const activeAfterThrow = vi.fn();
    store.subscribeGroup(lease, () => {
      throw new Error("group listener failed");
    });
    store.subscribeGroup(lease, groupAfterThrow);
    store.subscribeActive(() => {
      throw new Error("active listener failed");
    });
    store.subscribeActive(activeAfterThrow);

    expect(store.publish(lease, { column: 4, lineNumber: 5 })).toBe(true);
    expect(store.getActiveSnapshot()).toMatchObject({
      position: { column: 4, lineNumber: 5 },
      version: 1,
    });
    expect(groupAfterThrow).toHaveBeenCalledTimes(1);
    expect(activeAfterThrow).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledTimes(2);
  });

  it("routes 100 cursor moves only to the subscribed status projection", () => {
    const store = new EditorCursorStore();
    const lease = activate(store);
    const container = document.createElement("div");
    const root = createRoot(container);
    const commits = {
      editorSurface: 0,
      panel: 0,
      sidebar: 0,
      statusBar: 0,
      workbench: 0,
    };

    function StableEditorSurface() {
      commits.editorSurface += 1;
      return <div>editor</div>;
    }

    function StableSidebar() {
      commits.sidebar += 1;
      return <aside>sidebar</aside>;
    }

    function StablePanel() {
      commits.panel += 1;
      return <section>panel</section>;
    }

    function CursorStatus({ cursorStore }: { cursorStore: EditorCursorStorePort }) {
      commits.statusBar += 1;
      const snapshot = useSyncExternalStore(
        (listener) => cursorStore.subscribeActive(listener),
        () => cursorStore.getActiveSnapshot(),
      );
      const position = snapshot.status === "available" ? snapshot.position : null;
      return <footer>{position ? `${position.lineNumber}:${position.column}` : "-"}</footer>;
    }

    function Workbench() {
      commits.workbench += 1;
      return (
        <>
          <StableSidebar />
          <StableEditorSurface />
          <StablePanel />
          <CursorStatus cursorStore={store} />
        </>
      );
    }

    act(() => root.render(<Workbench />));
    const afterMount = { ...commits };

    act(() => {
      for (let index = 1; index <= 100; index += 1) {
        expect(store.publish(lease, { column: index, lineNumber: index })).toBe(true);
      }
    });

    expect(container.querySelector("footer")?.textContent).toBe("100:100");
    expect(commits.workbench).toBe(afterMount.workbench);
    expect(commits.editorSurface).toBe(afterMount.editorSurface);
    expect(commits.sidebar).toBe(afterMount.sidebar);
    expect(commits.panel).toBe(afterMount.panel);
    expect(commits.statusBar).toBeGreaterThan(afterMount.statusBar);
    act(() => root.unmount());
  });
});
