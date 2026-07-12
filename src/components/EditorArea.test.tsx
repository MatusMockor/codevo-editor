// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorGroupsState } from "../domain/editorGroups";
import type { EditorDocument } from "../domain/workspace";
import { EditorArea, type EditorAreaProps } from "./EditorArea";

describe("EditorArea", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("renders a nested mixed layout with stable group-qualified tab panels", () => {
    render({});
    expect([...host.querySelectorAll(".editor-group")].map((node) => node.getAttribute("data-editor-group-id")))
      .toEqual(["left", "top-right", "bottom-right"]);
    expect([...host.querySelectorAll(".editor-split")].map((node) => node.className))
      .toEqual(expect.arrayContaining([expect.stringContaining("horizontal"), expect.stringContaining("vertical")]));
    const ids = [...host.querySelectorAll("button[role='tab']")].map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const tab of host.querySelectorAll("button[role='tab']")) {
      expect(document.getElementById(tab.getAttribute("aria-controls") ?? "")?.getAttribute("role")).toBe("tabpanel");
    }
    expect(host.textContent).toContain("content:left:/shared.ts");
    expect(host.textContent).toContain("empty:bottom-right");
  });

  it("captures pointer and keyboard focus to activate a group", () => {
    const onActivateGroup = vi.fn();
    render({ onActivateGroup });
    const group = required(host, "[data-editor-group-id='top-right']");
    act(() => required(group, "button[role='tab']").focus());
    expect(onActivateGroup).toHaveBeenCalledWith("top-right");
    onActivateGroup.mockClear();
    act(() => group.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(onActivateGroup).toHaveBeenCalledWith("top-right");
  });

  function render(overrides: Partial<EditorAreaProps>) {
    const props: EditorAreaProps = {
      documents: [doc("/shared.ts"), doc("/bottom.ts")],
      projectId: "project",
      state,
      onActivateGroup: vi.fn(), onActivateTab: vi.fn(), onCloseTab: vi.fn(), onMoveTab: vi.fn(),
      onPinTab: vi.fn(), onReorderTab: vi.fn(), onResizeSplit: vi.fn(),
      renderContent: (surface, groupId) => surface.kind === "document"
        ? `content:${groupId}:${surface.path}` : `empty:${groupId}`,
      ...overrides,
    };
    act(() => root.render(<EditorArea {...props} />));
  }
});

const state: EditorGroupsState = {
  activeGroupId: "left",
  groups: {
    left: { activePath: "/shared.ts", openPaths: ["/shared.ts"], previewPath: null },
    "top-right": { activePath: "/shared.ts", openPaths: ["/shared.ts"], previewPath: null },
    "bottom-right": { activePath: null, openPaths: [], previewPath: null },
  },
  layout: { kind: "split", orientation: "horizontal", sizes: [0.4, 0.6], children: [
    { kind: "group", groupId: "left" },
    { kind: "split", orientation: "vertical", sizes: [0.5, 0.5], children: [
      { kind: "group", groupId: "top-right" }, { kind: "group", groupId: "bottom-right" },
    ] },
  ] },
};
function doc(path: string): EditorDocument {
  return { content: "", language: "typescript", name: path.slice(1), path, savedContent: "" };
}
function required(host: ParentNode, selector: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
