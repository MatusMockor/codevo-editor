// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { EditorGroupView } from "./EditorGroupView";

describe("EditorGroupView", () => {
  it("orders group membership and always owns the active tabpanel wrapper", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const documents = [doc("/one.ts"), doc("/preview.ts"), doc("/unrelated.ts")];
    act(() => root.render(
      <EditorGroupView
        active
        documents={documents}
        group={{ activePath: "/preview.ts", openPaths: ["/one.ts"], previewPath: "/preview.ts" }}
        groupId="group/a"
        onActivateGroup={vi.fn()} onActivateTab={vi.fn()} onCloseTab={vi.fn()} onMoveTab={vi.fn()}
        onPinTab={vi.fn()} onReorderTab={vi.fn()} projectId="project"
        renderContent={(surface) => surface.kind === "document" ? surface.document.name : "empty"}
      />,
    ));
    expect([...host.querySelectorAll(".tab-name")].map((node) => node.textContent)).toEqual(["one.ts", "preview.ts"]);
    const panel = host.querySelector("[role='tabpanel']");
    const activeTab = host.querySelector("[aria-selected='true']");
    expect(panel?.id).toBe(activeTab?.getAttribute("aria-controls"));
    expect(panel?.getAttribute("aria-labelledby")).toBe(activeTab?.id);
    expect(panel?.textContent).toBe("preview.ts");
    act(() => root.unmount());
  });

  it("does not reactivate an already-active group on focus or pointer events", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const onActivateGroup = vi.fn();
    act(() => root.render(
      <EditorGroupView
        active
        documents={[doc("/one.ts")]}
        group={{ activePath: "/one.ts", openPaths: ["/one.ts"], previewPath: null }}
        groupId="active-group"
        onActivateGroup={onActivateGroup} onActivateTab={vi.fn()} onCloseTab={vi.fn()} onMoveTab={vi.fn()}
        onPinTab={vi.fn()} onReorderTab={vi.fn()} projectId="project"
        renderContent={() => null}
      />,
    ));
    const group = host.querySelector<HTMLElement>(".editor-group");
    const tab = host.querySelector<HTMLButtonElement>("button[role='tab']");
    act(() => {
      tab?.focus();
      group?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onActivateGroup).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

function doc(path: string): EditorDocument {
  return { content: "", language: "typescript", name: path.slice(1), path, savedContent: "" };
}
