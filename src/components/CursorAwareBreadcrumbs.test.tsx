// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { EditorCursorStore } from "../application/editorCursorStore";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import { CursorAwareBreadcrumbs } from "./CursorAwareBreadcrumbs";

const ownerKey = createLegacyEditorSessionOwnerKey("/workspace");
const symbols: LanguageServerDocumentSymbol[] = [
  {
    children: [],
    containerName: null,
    detail: null,
    kind: 12,
    name: "handler",
    range: {
      end: { character: 1, line: 10 },
      start: { character: 0, line: 0 },
    },
    selectionRange: {
      end: { character: 8, line: 1 },
      start: { character: 0, line: 1 },
    },
  },
];

describe("CursorAwareBreadcrumbs", () => {
  it("switches an inactive pane to its exact group subscription", () => {
    const store = new EditorCursorStore();
    const first = store.activate({
      documentPath: "/workspace/a.ts",
      groupId: "group-1",
      ownerKey,
    });
    if (!first) throw new Error("Expected first group lease");
    store.publish(first, { column: 1, lineNumber: 2 });
    const subscribeActive = vi.spyOn(store, "subscribeActive");
    const subscribeGroup = vi.spyOn(store, "subscribeGroup");
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = (trackingActive: boolean) => (
      <CursorAwareBreadcrumbs
        documentPath="/workspace/a.ts"
        fileName="a.ts"
        groupId="group-1"
        onNavigate={() => {}}
        ownerKey={ownerKey}
        store={store}
        symbols={symbols}
        trackingActive={trackingActive}
      />
    );

    act(() => root.render(render(true)));
    expect(container.textContent).toContain("handler");
    act(() => root.render(render(false)));
    expect(subscribeGroup).toHaveBeenCalledWith(first, expect.any(Function));
    const inactiveMarkup = container.innerHTML;
    const second = store.activate({
      documentPath: "/workspace/b.ts",
      groupId: "group-2",
      ownerKey,
    });
    if (!second) throw new Error("Expected second group lease");
    for (let index = 1; index <= 100; index += 1) {
      store.publish(second, { column: index, lineNumber: index });
    }
    expect(container.innerHTML).toBe(inactiveMarkup);
    expect(subscribeActive).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("clears a retained path for a same-authority remount with no position", () => {
    const store = new EditorCursorStore();
    const first = store.activate({
      documentPath: "/workspace/a.ts",
      groupId: "group-1",
      ownerKey,
    });
    if (!first) throw new Error("Expected first lease");
    store.publish(first, { column: 1, lineNumber: 2 });
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <CursorAwareBreadcrumbs
          documentPath="/workspace/a.ts"
          fileName="a.ts"
          groupId="group-1"
          onNavigate={() => {}}
          ownerKey={ownerKey}
          store={store}
          symbols={symbols}
          trackingActive
        />,
      ),
    );
    expect(container.textContent).toContain("handler");

    let remounted: ReturnType<EditorCursorStore["activate"]> = null;
    act(() => {
      remounted = store.activate({
        documentPath: "/workspace/a.ts",
        groupId: "group-1",
        ownerKey,
      });
    });
    if (!remounted) throw new Error("Expected remounted lease");
    const remountedSnapshot = store.getActiveSnapshot();
    expect(
      remountedSnapshot.status === "available" &&
        remountedSnapshot.authority.generation > first.generation,
    ).toBe(true);
    expect(container.textContent).not.toContain("handler");
    act(() => root.unmount());
  });
});
