import { describe, expect, it } from "vitest";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { EditorCursorStore } from "./editorCursorStore";
import { bindEditorCursorPublisher, createEditorCursorPositionRef } from "./editorCursorBindings";

describe("editor cursor bindings", () => {
  it("keeps navigation ref reads on the active exact owner and forbids unscoped writes", () => {
    const store = new EditorCursorStore();
    const positionRef = createEditorCursorPositionRef(store);
    const first = store.activate({
      documentPath: "/workspace/a.ts",
      groupId: "group-1",
      ownerKey: createLegacyEditorSessionOwnerKey("/workspace"),
    });
    if (!first) throw new Error("Expected first cursor lease");

    bindEditorCursorPublisher(store, first)({ column: 4, lineNumber: 3 });
    expect(positionRef.current).toEqual({ column: 4, lineNumber: 3 });

    const stalePublisher = bindEditorCursorPublisher(store, first);
    const second = store.activate({
      documentPath: "/workspace/b.ts",
      groupId: "group-1",
      ownerKey: createLegacyEditorSessionOwnerKey("/workspace"),
    });
    if (!second) throw new Error("Expected second cursor lease");

    stalePublisher({ column: 99, lineNumber: 99 });
    expect(positionRef.current).toBeNull();

    bindEditorCursorPublisher(store, second)({ column: 8, lineNumber: 7 });
    expect(positionRef.current).toEqual({ column: 8, lineNumber: 7 });
    expect(() => {
      (positionRef as { current: { column: number; lineNumber: number } | null }).current = {
        column: 100,
        lineNumber: 100,
      };
    }).toThrow(TypeError);
    expect(positionRef.current).toEqual({ column: 8, lineNumber: 7 });
  });
});
