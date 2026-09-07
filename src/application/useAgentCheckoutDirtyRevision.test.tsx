// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EditorDocumentDirtyProjection,
  EditorOwnerDirtyCountProjection,
} from "./editorSessionDirtyProjection";
import { useAgentCheckoutDirtyRevision } from "./useAgentCheckoutDirtyRevision";

const state = vi.hoisted(() => ({
  dirty: new Map<object, boolean>(),
  listeners: new Set<() => void>(),
  cleanup: vi.fn(),
}));
vi.mock("./editorSessionDirtyProjection", () => ({
  getEditorDocumentDirtySnapshot: (projection: object) => ({
    status: "available",
    dirty: state.dirty.get(projection) ?? false,
  }),
  subscribeEditorOwnerDirtyCountProjection: (_owner: object, listener: () => void) => {
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
      state.cleanup();
    };
  },
}));

describe("checkout live dirty subscription", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    state.dirty.clear();
    state.listeners.clear();
    state.cleanup.mockClear();
  });
  it("reacts to live edits and same-count dirty file swaps without copying text", async () => {
    const first: EditorDocumentDirtyProjection = { kind: "editor-document-dirty-projection" };
    const second: EditorDocumentDirtyProjection = { kind: "editor-document-dirty-projection" };
    const owner: EditorOwnerDirtyCountProjection = { kind: "editor-owner-dirty-count-projection" };
    const documents = [{ path: "/repo/a" }, { path: "/repo/b" }];
    const resolve = (path: string) => (path.endsWith("a") ? first : second);
    const root = createRoot(document.createElement("div"));
    let result = "";
    function Harness() {
      result = useAgentCheckoutDirtyRevision(documents, resolve, owner);
      return null;
    }
    await act(async () => root.render(<Harness />));
    expect(result).toBe("00");
    act(() => {
      state.dirty.set(first, true);
      state.listeners.forEach((notify) => notify());
    });
    expect(result).toBe("10");
    act(() => {
      state.dirty.set(first, false);
      state.dirty.set(second, true);
      state.listeners.forEach((notify) => notify());
    });
    expect(result).toBe("01");
    await act(async () => root.unmount());
    expect(state.listeners.size).toBe(0);
    expect(state.cleanup).toHaveBeenCalledOnce();
  });
});
