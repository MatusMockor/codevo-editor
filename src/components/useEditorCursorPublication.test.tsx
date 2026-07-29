// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { editor } from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { EditorCursorStore } from "../application/editorCursorStore";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { useEditorCursorPublication } from "./useEditorCursorPublication";

function fakeEditor(initialPosition: EditorPosition | null) {
  const handlers = new Set<(event: { position: EditorPosition }) => void>();
  return {
    api: {
      getPosition: () => initialPosition,
      onDidChangeCursorPosition: (handler: (event: { position: EditorPosition }) => void) => {
        handlers.add(handler);
        return { dispose: () => handlers.delete(handler) };
      },
    } as unknown as editor.IStandaloneCodeEditor,
    emit(position: EditorPosition) {
      for (const handler of [...handlers]) handler({ position });
    },
    handlers,
  };
}

describe("useEditorCursorPublication", () => {
  it("publishes the initial position and rejects A-B-A stale producers", () => {
    const store = new EditorCursorStore();
    const ownerKey = createLegacyEditorSessionOwnerKey("/workspace");
    const firstA = fakeEditor({ column: 1, lineNumber: 1 });
    const b = fakeEditor({ column: 2, lineNumber: 2 });
    const secondA = fakeEditor({ column: 3, lineNumber: 3 });
    const published = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness({ api, path }: { api: editor.IStandaloneCodeEditor; path: string | null }) {
      const onPositionRef = useRef(published);
      const [, setLegacyPosition] = useState<EditorPosition | null>(null);
      useEditorCursorPublication({
        activeDocumentPath: path,
        cursorStore: store,
        editorApi: api,
        groupId: "main",
        onPositionRef,
        ownerKey,
        setLegacyPosition,
        trackingActive: true,
      });
      return null;
    }

    act(() => root.render(<Harness api={firstA.api} path="/workspace/a.ts" />));
    const firstLease = store.getActiveSnapshot();
    expect(firstLease).toMatchObject({ position: { column: 1, lineNumber: 1 } });

    act(() => root.render(<Harness api={b.api} path="/workspace/b.ts" />));
    const bLease = store.getActiveSnapshot();
    expect(bLease).toMatchObject({ position: { column: 2, lineNumber: 2 } });
    firstA.emit({ column: 99, lineNumber: 99 });
    expect(store.getActiveSnapshot()).toBe(bLease);

    act(() => root.render(<Harness api={secondA.api} path="/workspace/a.ts" />));
    const secondLease = store.getActiveSnapshot();
    expect(secondLease).toMatchObject({ position: { column: 3, lineNumber: 3 } });
    expect(
      firstLease.status === "available" &&
        secondLease.status === "available" &&
        secondLease.authority.generation > firstLease.authority.generation,
    ).toBe(true);
    b.emit({ column: 88, lineNumber: 88 });
    expect(store.getActiveSnapshot()).toBe(secondLease);
    act(() => root.unmount());
    expect(store.getActiveSnapshot()).toEqual({ status: "unavailable" });
  });

  it("does not publish while inactive and remounts same authority with a fresh lease", () => {
    const store = new EditorCursorStore();
    const ownerKey = createLegacyEditorSessionOwnerKey("/workspace");
    const first = fakeEditor(null);
    const remount = fakeEditor(null);
    const published = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness({
      api,
      trackingActive,
    }: {
      api: editor.IStandaloneCodeEditor;
      trackingActive: boolean;
    }) {
      const onPositionRef = useRef(published);
      const [, setLegacyPosition] = useState<EditorPosition | null>(null);
      useEditorCursorPublication({
        activeDocumentPath: "/workspace/a.ts",
        cursorStore: store,
        editorApi: api,
        groupId: "main",
        onPositionRef,
        ownerKey,
        setLegacyPosition,
        trackingActive,
      });
      return null;
    }

    act(() => root.render(<Harness api={first.api} trackingActive />));
    const firstSnapshot = store.getActiveSnapshot();
    expect(firstSnapshot).toMatchObject({ position: null, status: "available" });
    act(() => root.render(<Harness api={first.api} trackingActive={false} />));
    first.emit({ column: 7, lineNumber: 7 });
    expect(store.getActiveSnapshot()).toEqual({ status: "unavailable" });
    expect(published).not.toHaveBeenCalled();

    act(() => root.render(<Harness api={remount.api} trackingActive />));
    const remountedSnapshot = store.getActiveSnapshot();
    expect(
      firstSnapshot.status === "available" &&
        remountedSnapshot.status === "available" &&
        remountedSnapshot.authority.generation > firstSnapshot.authority.generation,
    ).toBe(true);
    first.emit({ column: 9, lineNumber: 9 });
    expect(store.getActiveSnapshot()).toBe(remountedSnapshot);
    act(() => root.unmount());
  });
});
