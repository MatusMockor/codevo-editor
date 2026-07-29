// @vitest-environment jsdom

import { act, memo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { LiveDocumentRuntime } from "../application/liveDocumentRuntime";
import type { EditorGroupsState } from "../domain/editorGroups";
import type { EditorDocument } from "../domain/workspace";
import type { EditorGroupSurface } from "./EditorGroupView";
import { WorkbenchEditorHost } from "./WorkbenchEditorHost";

const runtimeHostSpy = vi.hoisted(() => vi.fn());

vi.mock("./EditorRuntimeHost", () => ({
  EditorRuntimeHost: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => {
    runtimeHostSpy(props);
    return children;
  },
}));

describe("WorkbenchEditorHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    runtimeHostSpy.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("commits an active edit without committing the inactive group surface", () => {
    const commits = { active: 0, inactive: 0 };
    const activeDocument = editorDocument("/active.ts", "");
    const inactiveDocument = editorDocument("/inactive.ts", "");
    const inactiveRevision = Object.freeze({});
    const Surface = memo(function Surface({
      content,
      groupId,
    }: {
      content: string;
      groupId: "active" | "inactive";
    }) {
      commits[groupId] += 1;
      return <div>{content}</div>;
    });
    const renderContent = (surface: EditorGroupSurface, groupId: string) =>
      surface.kind === "document" && "content" in surface.document ? (
        <Surface content={surface.document.content} groupId={groupId as "active" | "inactive"} />
      ) : null;
    const stableProps = hostProps(state);
    const initialActiveRevision = Object.freeze({});
    act(() => {
      root.render(
        <WorkbenchEditorHost
          {...stableProps}
          contentRevisionForGroup={(groupId) =>
            groupId === "active" ? initialActiveRevision : inactiveRevision
          }
          documents={[activeDocument, inactiveDocument]}
          renderContent={renderContent}
        />,
      );
    });
    commits.active = 0;
    commits.inactive = 0;

    const nextActiveRevision = Object.freeze({});
    act(() => {
      root.render(
        <WorkbenchEditorHost
          {...stableProps}
          contentRevisionForGroup={(groupId) =>
            groupId === "active" ? nextActiveRevision : inactiveRevision
          }
          documents={[{ ...activeDocument, content: "const edited = true;" }, inactiveDocument]}
          renderContent={(surface, groupId) => renderContent(surface, groupId)}
        />,
      );
    });

    expect(commits).toEqual({ active: 1, inactive: 0 });
  });

  it("forwards only the explicit active-group and exact session runtime contract", () => {
    const props = hostProps(state);
    const revision = Object.freeze({});
    const onBinding = vi.fn();

    act(() => {
      root.render(
        <WorkbenchEditorHost
          {...props}
          documentSessionAuthorityRevision={revision}
          onActiveLiveDocumentBindingChange={onBinding}
          documents={[]}
          renderContent={() => null}
        />,
      );
    });

    expect(runtimeHostSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        activeGroupId: state.activeGroupId,
        attachEditorGroupLiveDocument: props.attachEditorGroupLiveDocument,
        documentSessionAuthorityRevision: revision,
        isEditorGroupDocumentSessionAuthorityCurrent:
          props.isEditorGroupDocumentSessionAuthorityCurrent,
        liveDocumentRuntime: props.liveDocumentRuntime,
        onActiveLiveDocumentBindingChange: onBinding,
        resolveEditorGroupDocumentSessionAuthority:
          props.resolveEditorGroupDocumentSessionAuthority,
      }),
    );
  });

  it("commits an inactive document mutation without committing the active group surface", () => {
    const commits = { active: 0, inactive: 0 };
    const activeDocument = editorDocument("/active.ts", "");
    const inactiveDocument = editorDocument("/inactive.ts", "");
    const activeRevision = Object.freeze({});
    const initialInactiveRevision = Object.freeze({});
    const Surface = memo(function Surface({
      content,
      groupId,
    }: {
      content: string;
      groupId: "active" | "inactive";
    }) {
      commits[groupId] += 1;
      return <div>{content}</div>;
    });
    const renderContent = (surface: EditorGroupSurface, groupId: string) =>
      surface.kind === "document" && "content" in surface.document ? (
        <Surface content={surface.document.content} groupId={groupId as "active" | "inactive"} />
      ) : null;
    const stableProps = hostProps(state);

    act(() => {
      root.render(
        <WorkbenchEditorHost
          {...stableProps}
          contentRevisionForGroup={(groupId) =>
            groupId === "active" ? activeRevision : initialInactiveRevision
          }
          documents={[activeDocument, inactiveDocument]}
          renderContent={renderContent}
        />,
      );
    });
    commits.active = 0;
    commits.inactive = 0;

    const nextInactiveRevision = Object.freeze({});
    act(() => {
      root.render(
        <WorkbenchEditorHost
          {...stableProps}
          contentRevisionForGroup={(groupId) =>
            groupId === "active" ? activeRevision : nextInactiveRevision
          }
          documents={[activeDocument, { ...inactiveDocument, content: "const changed = true;" }]}
          renderContent={(surface, groupId) => renderContent(surface, groupId)}
        />,
      );
    });

    expect(commits).toEqual({ active: 0, inactive: 1 });
    expect(required(host, "[data-editor-group-id='inactive'] .editor-panel").textContent).toBe(
      "const changed = true;",
    );
  });

  it("keeps the correct surface active across an active group A to B to A transition", () => {
    const documents = [
      editorDocument("/active.ts", "surface-a"),
      editorDocument("/inactive.ts", "surface-b"),
    ];
    const stableProps = hostProps(state);
    const renderContent = (surface: EditorGroupSurface, groupId: string) => (
      <div data-surface={groupId}>
        {surface.kind === "document" && "content" in surface.document
          ? surface.document.content
          : "empty"}
      </div>
    );
    const renderActiveGroup = (activeGroupId: "active" | "inactive") => {
      act(() => {
        root.render(
          <WorkbenchEditorHost
            {...stableProps}
            documents={documents}
            renderContent={renderContent}
            state={{ ...state, activeGroupId }}
          />,
        );
      });
    };

    renderActiveGroup("active");
    expect(activeGroupId(host)).toBe("active");
    expect(required(host, "[data-surface='active']").textContent).toBe("surface-a");
    expect(required(host, "[data-surface='inactive']").textContent).toBe("surface-b");

    renderActiveGroup("inactive");
    expect(activeGroupId(host)).toBe("inactive");
    expect(required(host, "[data-surface='active']").textContent).toBe("surface-a");
    expect(required(host, "[data-surface='inactive']").textContent).toBe("surface-b");

    renderActiveGroup("active");
    expect(activeGroupId(host)).toBe("active");
    expect(required(host, "[data-surface='active']").textContent).toBe("surface-a");
    expect(required(host, "[data-surface='inactive']").textContent).toBe("surface-b");
  });

  it("adds, resizes, and removes a split without unnecessarily committing its two surfaces", () => {
    const commits = { active: 0, inactive: 0 };
    const documents = [
      editorDocument("/active.ts", "surface-a"),
      editorDocument("/inactive.ts", "surface-b"),
    ];
    const onResizeSplit = vi.fn();
    const Surface = function Surface({ groupId }: { groupId: "active" | "inactive" }) {
      commits[groupId] += 1;
      return <div data-surface={groupId}>{groupId}</div>;
    };
    const renderContent = (_surface: EditorGroupSurface, groupId: string) => (
      <Surface groupId={groupId as "active" | "inactive"} />
    );
    const activeGroup = state.groups.active;
    const singleState: EditorGroupsState = {
      activeGroupId: "active",
      groups: { active: activeGroup },
      layout: { groupId: "active", kind: "group" },
    };
    const stableProps = {
      ...hostProps(singleState),
      onResizeSplit,
    };
    const renderState = (nextState: EditorGroupsState) => {
      act(() => {
        root.render(
          <WorkbenchEditorHost
            {...stableProps}
            documents={documents}
            renderContent={renderContent}
            state={nextState}
          />,
        );
      });
    };

    renderState(singleState);
    expect(host.querySelectorAll("[data-surface]")).toHaveLength(1);

    renderState(state);
    expect(host.querySelectorAll("[data-surface]")).toHaveLength(2);
    expect(required(host, "[data-surface='active']").textContent).toBe("active");
    expect(required(host, "[data-surface='inactive']").textContent).toBe("inactive");
    commits.active = 0;
    commits.inactive = 0;

    const separator = required(host, "[role='separator']");
    act(() => {
      separator.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    expect(onResizeSplit).toHaveBeenLastCalledWith([], [0.52, 0.48]);

    if (state.layout.kind !== "split") {
      throw new Error("Expected the shared two-group state to use a split layout.");
    }
    renderState({
      ...state,
      layout: { ...state.layout, sizes: [0.52, 0.48] },
    });
    expect(host.querySelectorAll("[data-surface]")).toHaveLength(2);
    expect(commits).toEqual({ active: 0, inactive: 0 });
    expect(required(host, "[role='separator']").getAttribute("aria-valuenow")).toBe("52");

    renderState(singleState);
    expect(host.querySelectorAll("[data-surface]")).toHaveLength(1);
    expect(required(host, "[data-surface='active']").textContent).toBe("active");
  });

  it("remounts surfaces for every workspace owner generation across A to B to A", () => {
    let nextSurfaceId = 0;
    const document = editorDocument("/active.ts", "owner-content");
    const singleState: EditorGroupsState = {
      activeGroupId: "active",
      groups: { active: state.groups.active },
      layout: { groupId: "active", kind: "group" },
    };
    function Surface() {
      const surfaceId = useRef<number | null>(null);
      if (surfaceId.current === null) {
        surfaceId.current = ++nextSurfaceId;
      }
      return <div data-surface-id={surfaceId.current}>owner-content</div>;
    }
    const stableProps = hostProps(singleState);
    const renderOwner = (workspaceId: "owner-a" | "owner-b") => {
      act(() => {
        root.render(
          <WorkbenchEditorHost
            {...stableProps}
            documents={[document]}
            editorSessionOwnerKey={createEditorSessionOwnerKey(workspaceId, "/workspace")}
            renderContent={() => <Surface />}
          />,
        );
      });
      return required(host, "[data-surface-id]").dataset.surfaceId;
    };

    const firstA = renderOwner("owner-a");
    const ownerB = renderOwner("owner-b");
    const secondA = renderOwner("owner-a");

    expect([firstA, ownerB, secondA]).toEqual(["1", "2", "3"]);
    expect(required(host, "[data-surface-id]").textContent).toBe("owner-content");
  });
});

const state: EditorGroupsState = {
  activeGroupId: "active",
  groups: {
    active: {
      activePath: "/active.ts",
      openPaths: ["/active.ts"],
      previewPath: null,
    },
    inactive: {
      activePath: "/inactive.ts",
      openPaths: ["/inactive.ts"],
      previewPath: null,
    },
  },
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

function editorDocument(path: string, content: string): EditorDocument {
  return {
    content,
    language: "typescript",
    name: path.slice(1),
    path,
    savedContent: "",
  };
}

function hostProps(editorState: EditorGroupsState) {
  return {
    activeGroupId: editorState.activeGroupId,
    attachEditorGroupLiveDocument: vi.fn(() => null),
    documentSessionAuthorityRevision: null,
    editorSessionOwnerKey: null,
    isEditorGroupDocumentSessionAuthorityCurrent: () => false,
    liveDocumentRuntime: new LiveDocumentRuntime(),
    onActivateGroup: vi.fn(),
    onCloseDocument: vi.fn(async () => undefined),
    onMoveTab: vi.fn(),
    onPinTab: vi.fn(),
    onSetActivePath: vi.fn(),
    projectId: "/workspace",
    resolveEditorGroupDocumentSessionAuthority: () => null,
    state: editorState,
  };
}

function required(parent: ParentNode, selector: string): HTMLElement {
  const element = parent.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}

function activeGroupId(parent: ParentNode): string | null {
  return required(parent, ".editor-group.active").dataset.editorGroupId ?? null;
}
