// @vitest-environment jsdom

import { act, memo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
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
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders a nested mixed layout with stable group-qualified tab panels", () => {
    render({});
    expect(
      [...host.querySelectorAll(".editor-group")].map((node) =>
        node.getAttribute("data-editor-group-id"),
      ),
    ).toEqual(["left", "top-right", "bottom-right"]);
    expect([...host.querySelectorAll(".editor-split")].map((node) => node.className)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("horizontal"),
        expect.stringContaining("vertical"),
      ]),
    );
    const ids = [...host.querySelectorAll("button[role='tab']")].map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const tab of host.querySelectorAll("button[role='tab']")) {
      expect(
        document.getElementById(tab.getAttribute("aria-controls") ?? "")?.getAttribute("role"),
      ).toBe("tabpanel");
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

  it("remounts the editor group when the session owner is replaced at the same root", () => {
    let nextSurfaceId = 0;
    function SurfaceProbe({ path }: { path: string }) {
      const surfaceId = useRef<number | null>(null);
      if (surfaceId.current === null) {
        surfaceId.current = ++nextSurfaceId;
      }
      return <div data-surface-id={surfaceId.current}>{path}</div>;
    }
    const path = "/project/src/baseRouter.ts";
    const renderOwner = (editorSessionOwnerKey: EditorAreaProps["editorSessionOwnerKey"]) =>
      render({
        documents: [doc(path)],
        editorSessionOwnerKey,
        projectId: "/project",
        renderContent: (surface) =>
          surface.kind === "document" ? <SurfaceProbe path={surface.path} /> : null,
        state: singleGroupState(path),
      });

    renderOwner(createEditorSessionOwnerKey("owner-a", "/project"));
    const firstSurfaceId = required(host, "[data-surface-id]").dataset.surfaceId;

    renderOwner(createEditorSessionOwnerKey("owner-b", "/project"));

    const replacementSurface = required(host, "[data-surface-id]");
    expect(replacementSurface.textContent).toBe(path);
    expect(replacementSurface.dataset.surfaceId).not.toBe(firstSurfaceId);
    expect(nextSurfaceId).toBe(2);
  });

  it("keeps the editor group mounted when an alias resolves to the same session owner", () => {
    let nextSurfaceId = 0;
    function SurfaceProbe({ path }: { path: string }) {
      const surfaceId = useRef<number | null>(null);
      if (surfaceId.current === null) {
        surfaceId.current = ++nextSurfaceId;
      }
      return <div data-surface-id={surfaceId.current}>{path}</div>;
    }
    const path = "/canonical-project/src/baseRouter.ts";
    const editorSessionOwnerKey = createEditorSessionOwnerKey("stable-owner", "/canonical-project");
    const renderProject = (projectId: string) =>
      render({
        documents: [doc(path)],
        editorSessionOwnerKey,
        projectId,
        renderContent: (surface) =>
          surface.kind === "document" ? <SurfaceProbe path={surface.path} /> : null,
        state: singleGroupState(path),
      });

    renderProject("/project-alias-a");
    const firstSurfaceId = required(host, "[data-surface-id]").dataset.surfaceId;

    renderProject("/project-alias-b");

    const restoredSurface = required(host, "[data-surface-id]");
    expect(restoredSurface.textContent).toBe(path);
    expect(restoredSurface.dataset.surfaceId).toBe(firstSurfaceId);
    expect(nextSurfaceId).toBe(1);
  });

  it("does not commit the inactive editor surface when the active document changes", () => {
    const commits = { active: 0, inactive: 0 };
    const activePath = "/active.ts";
    const inactivePath = "/inactive.ts";
    const activeGroup = {
      activePath,
      openPaths: [activePath],
      previewPath: null,
    };
    const inactiveGroup = {
      activePath: inactivePath,
      openPaths: [inactivePath],
      previewPath: null,
    };
    const splitState: EditorGroupsState = {
      activeGroupId: "active",
      groups: { active: activeGroup, inactive: inactiveGroup },
      layout: {
        children: [
          { groupId: "active", kind: "group" },
          { groupId: "inactive", kind: "group" },
        ],
        kind: "split",
        orientation: "horizontal",
        sizes: [0.5, 0.5],
      },
    };
    const SurfaceProbe = memo(function SurfaceProbe({
      content,
      groupId,
    }: {
      content: string;
      groupId: "active" | "inactive";
    }) {
      commits[groupId] += 1;
      return <div>{content}</div>;
    });
    const createRenderContent = (): EditorAreaProps["renderContent"] => (surface, groupId) =>
      surface.kind === "document" && "content" in surface.document ? (
        <SurfaceProbe
          content={surface.document.content}
          groupId={groupId as "active" | "inactive"}
        />
      ) : null;
    const stableProps: Omit<
      EditorAreaProps,
      "contentRevisionForGroup" | "documents" | "renderContent"
    > = {
      editorSessionOwnerKey: createEditorSessionOwnerKey("project", "/project"),
      onActivateGroup: vi.fn(),
      onActivateTab: vi.fn(),
      onCloseTab: vi.fn(),
      onMoveTab: vi.fn(),
      onPinTab: vi.fn(),
      onReorderTab: vi.fn(),
      onResizeSplit: vi.fn(),
      projectId: "project",
      state: splitState,
    };
    const activeDocument = doc(activePath);
    const inactiveDocument = doc(inactivePath);
    const inactiveContentRevision = Object.freeze({});
    const initialActiveContentRevision = Object.freeze({});
    act(() => {
      root.render(
        <EditorArea
          {...stableProps}
          contentRevisionForGroup={(groupId) =>
            groupId === "active" ? initialActiveContentRevision : inactiveContentRevision
          }
          documents={[activeDocument, inactiveDocument]}
          renderContent={createRenderContent()}
        />,
      );
    });
    commits.active = 0;
    commits.inactive = 0;

    act(() => {
      const nextActiveContentRevision = Object.freeze({});
      root.render(
        <EditorArea
          {...stableProps}
          contentRevisionForGroup={(groupId) =>
            groupId === "active" ? nextActiveContentRevision : inactiveContentRevision
          }
          documents={[{ ...activeDocument, content: "const edited = true;" }, inactiveDocument]}
          renderContent={createRenderContent()}
        />,
      );
    });

    expect(commits).toEqual({ active: 1, inactive: 0 });
  });

  function render(overrides: Partial<EditorAreaProps>) {
    const props: EditorAreaProps = {
      documents: [doc("/shared.ts"), doc("/bottom.ts")],
      editorSessionOwnerKey: createEditorSessionOwnerKey("project", "/project"),
      projectId: "project",
      state,
      onActivateGroup: vi.fn(),
      onActivateTab: vi.fn(),
      onCloseTab: vi.fn(),
      onMoveTab: vi.fn(),
      onPinTab: vi.fn(),
      onReorderTab: vi.fn(),
      onResizeSplit: vi.fn(),
      renderContent: (surface, groupId) =>
        surface.kind === "document" ? `content:${groupId}:${surface.path}` : `empty:${groupId}`,
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
  layout: {
    kind: "split",
    orientation: "horizontal",
    sizes: [0.4, 0.6],
    children: [
      { kind: "group", groupId: "left" },
      {
        kind: "split",
        orientation: "vertical",
        sizes: [0.5, 0.5],
        children: [
          { kind: "group", groupId: "top-right" },
          { kind: "group", groupId: "bottom-right" },
        ],
      },
    ],
  },
};
function doc(path: string): EditorDocument {
  return { content: "", language: "typescript", name: path.slice(1), path, savedContent: "" };
}
function singleGroupState(path: string): EditorGroupsState {
  return {
    activeGroupId: "editor-main",
    groups: {
      "editor-main": { activePath: path, openPaths: [path], previewPath: null },
    },
    layout: { kind: "group", groupId: "editor-main" },
  };
}
function required(host: ParentNode, selector: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
