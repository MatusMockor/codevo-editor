// @vitest-environment jsdom

import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { EditorGroupView } from "./EditorGroupView";
import { WorkbenchFrameEditorContext } from "./workbenchFrameEditorReport";

describe("EditorGroupView", () => {
  it("orders group membership and always owns the active tabpanel wrapper", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const documents = [doc("/one.ts"), doc("/preview.ts"), doc("/unrelated.ts")];
    act(() =>
      root.render(
        <EditorGroupView
          active
          documents={documents}
          group={{ activePath: "/preview.ts", openPaths: ["/one.ts"], previewPath: "/preview.ts" }}
          groupId="group/a"
          onActivateGroup={vi.fn()}
          onActivateTab={vi.fn()}
          onCloseTab={vi.fn()}
          onMoveTab={vi.fn()}
          onPinTab={vi.fn()}
          onReorderTab={vi.fn()}
          projectId="project"
          renderContent={(surface) =>
            surface.kind === "document" ? surface.document.name : "empty"
          }
          tabsPlacement="inline"
        />,
      ),
    );
    expect([...host.querySelectorAll(".tab-name")].map((node) => node.textContent)).toEqual([
      "one.ts",
      "preview.ts",
    ]);
    const panel = host.querySelector("[role='tabpanel']");
    const activeTab = host.querySelector("[aria-selected='true']");
    const inactiveTab = host.querySelector("[aria-selected='false']");
    expect(panel?.id).toBe(activeTab?.getAttribute("aria-controls"));
    expect(panel?.getAttribute("aria-labelledby")).toBe(activeTab?.id);
    expect(inactiveTab?.hasAttribute("aria-controls")).toBe(false);
    expect(panel?.textContent).toBe("preview.ts");
    act(() => root.unmount());
  });

  it("does not reactivate an already-active group on focus or pointer events", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const onActivateGroup = vi.fn();
    act(() =>
      root.render(
        <EditorGroupView
          active
          documents={[doc("/one.ts")]}
          group={{ activePath: "/one.ts", openPaths: ["/one.ts"], previewPath: null }}
          groupId="active-group"
          onActivateGroup={onActivateGroup}
          onActivateTab={vi.fn()}
          onCloseTab={vi.fn()}
          onMoveTab={vi.fn()}
          onPinTab={vi.fn()}
          onReorderTab={vi.fn()}
          projectId="project"
          renderContent={() => null}
          tabsPlacement="inline"
        />,
      ),
    );
    const group = host.querySelector<HTMLElement>(".editor-group");
    const tab = host.querySelector<HTMLButtonElement>("button[role='tab']");
    act(() => {
      tab?.focus();
      group?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onActivateGroup).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("renders no tab row for the active group when tabs live in the panel strip", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const render = (active: boolean, tabsPlacement: "inline" | "strip") =>
      act(() =>
        root.render(
          <EditorGroupView
            active={active}
            documents={[doc("/orders.ts")]}
            group={{ activePath: "/orders.ts", openPaths: ["/orders.ts"], previewPath: null }}
            groupId="group/a"
            onActivateGroup={vi.fn()}
            onActivateTab={vi.fn()}
            onCloseTab={vi.fn()}
            onMoveTab={vi.fn()}
            onPinTab={vi.fn()}
            onReorderTab={vi.fn()}
            projectId="project"
            renderContent={() => <MonacoMount />}
            tabsPlacement={tabsPlacement}
          />,
        ),
      );

    render(true, "strip");
    const monaco = host.querySelector(".monaco-editor");
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector(".editor-panel")?.getAttribute("aria-label")).toBe("orders.ts");
    expect(host.querySelector(".editor-panel")?.hasAttribute("aria-labelledby")).toBe(false);

    render(false, "strip");
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(host.querySelector(".editor-panel")?.hasAttribute("aria-label")).toBe(false);
    expect(host.querySelector(".monaco-editor")).toBe(monaco);

    render(true, "inline");
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(host.querySelector(".monaco-editor")).toBe(monaco);
    act(() => root.unmount());
  });

  it("reports whether any document is open to the workbench frame", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const report = vi.fn();

    const render = (documents: EditorDocument[]) => {
      act(() =>
        root.render(
          <WorkbenchFrameEditorContext.Provider value={report}>
            <EditorGroupView
              active
              documents={documents}
              group={{
                activePath: documents[0]?.path ?? null,
                openPaths: documents.map((document) => document.path),
                previewPath: null,
              }}
              groupId="group/a"
              onActivateGroup={vi.fn()}
              onActivateTab={vi.fn()}
              onCloseTab={vi.fn()}
              onMoveTab={vi.fn()}
              onPinTab={vi.fn()}
              onReorderTab={vi.fn()}
              projectId="project"
              renderContent={() => null}
              tabsPlacement="inline"
            />
          </WorkbenchFrameEditorContext.Provider>,
        ),
      );
    };

    render([doc("/one.ts")]);
    expect(report).toHaveBeenLastCalledWith(expect.any(String), "documents");
    const key = report.mock.calls[0]?.[0];

    render([]);
    expect(report).toHaveBeenLastCalledWith(key, "empty");

    render([doc("/two.ts")]);
    expect(report).toHaveBeenLastCalledWith(key, "documents");

    act(() => root.unmount());
    expect(report).toHaveBeenLastCalledWith(key, null);
  });

  it("re-reports an empty sibling group when the host document list changes under it", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const report = vi.fn();
    const emptyGroup = { activePath: null, openPaths: [], previewPath: null };
    const handlers = {
      onActivateGroup: vi.fn(),
      onActivateTab: vi.fn(),
      onCloseTab: vi.fn(),
      onMoveTab: vi.fn(),
      onPinTab: vi.fn(),
      onReorderTab: vi.fn(),
      renderContent: () => null,
      tabsPlacement: "inline" as const,
    };
    const render = (documents: EditorDocument[]) => {
      act(() =>
        root.render(
          <WorkbenchFrameEditorContext.Provider value={report}>
            <EditorGroupView
              active={false}
              documents={documents}
              group={emptyGroup}
              groupId="group/empty"
              projectId="project"
              {...handlers}
            />
          </WorkbenchFrameEditorContext.Provider>,
        ),
      );
    };

    render([]);
    expect(report).toHaveBeenLastCalledWith(expect.any(String), "empty");

    render([doc("/other-group.ts")]);
    expect(report).toHaveBeenLastCalledWith(expect.any(String), "documents");

    render([]);
    expect(report).toHaveBeenLastCalledWith(expect.any(String), "empty");
    act(() => root.unmount());
  });

  it("keeps MRU cycling bound to the exact active group when its tabs live in the strip", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const firstActivations: string[] = [];
    const secondActivations: string[] = [];
    let replaceActiveGroup = (_active: boolean): void => undefined;

    function Harness() {
      const [firstActive, setFirstActive] = useState(true);
      const [firstPath, setFirstPath] = useState("/first-a.ts");
      const [secondPath, setSecondPath] = useState("/second-a.ts");
      replaceActiveGroup = setFirstActive;
      return (
        <div className="editor-area">
          <EditorGroupView
            active={firstActive}
            documents={[doc("/first-a.ts"), doc("/first-b.ts")]}
            group={{
              activePath: firstPath,
              openPaths: ["/first-a.ts", "/first-b.ts"],
              previewPath: null,
            }}
            groupId="group/first"
            onActivateGroup={() => setFirstActive(true)}
            onActivateTab={(_groupId, path) => {
              firstActivations.push(path);
              setFirstPath(path);
            }}
            onCloseTab={vi.fn()}
            onMoveTab={vi.fn()}
            onPinTab={vi.fn()}
            onReorderTab={vi.fn()}
            projectId="project"
            renderContent={(surface) =>
              surface.kind === "document" && surface.path === "/first-a.ts" ? (
                <textarea aria-label="First editor" className="inputarea" />
              ) : (
                <section aria-label="First preview" />
              )
            }
            tabsPlacement="strip"
          />
          <EditorGroupView
            active={!firstActive}
            documents={[doc("/second-a.ts"), doc("/second-b.ts")]}
            group={{
              activePath: secondPath,
              openPaths: ["/second-a.ts", "/second-b.ts"],
              previewPath: null,
            }}
            groupId="group/second"
            onActivateGroup={() => setFirstActive(false)}
            onActivateTab={(_groupId, path) => {
              secondActivations.push(path);
              setSecondPath(path);
            }}
            onCloseTab={vi.fn()}
            onMoveTab={vi.fn()}
            onPinTab={vi.fn()}
            onReorderTab={vi.fn()}
            projectId="project"
            renderContent={() => <textarea aria-label="Second editor" className="inputarea" />}
            tabsPlacement="strip"
          />
        </div>
      );
    }

    await act(async () => root.render(<Harness />));
    const firstEditor = host.querySelector<HTMLTextAreaElement>("[aria-label='First editor']");
    act(() => {
      firstEditor?.focus();
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });
    expect(document.body.querySelector("[aria-label='Open editors']")).not.toBeNull();

    act(() => pressWindowKey("keyup", "Control"));
    expect(firstActivations).toEqual(["/first-b.ts"]);
    expect(secondActivations).toEqual([]);
    expect(document.activeElement).toBe(
      host.querySelector("[data-editor-group-id='group/first'] .editor-panel"),
    );

    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keydown", "Escape", { ctrlKey: true });
    });
    expect(document.body.querySelector("[aria-label='Open editors']")).toBeNull();
    expect(firstActivations).toEqual(["/first-b.ts"]);
    act(() => pressWindowKey("keyup", "Control"));

    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));
    expect(document.body.querySelector("[aria-label='Open editors']")).not.toBeNull();
    await act(async () => {
      replaceActiveGroup(false);
      await Promise.resolve();
    });
    expect(document.body.querySelector("[aria-label='Open editors']")).toBeNull();
    expect(host.querySelectorAll(".editor-tabs")).toHaveLength(1);
    expect(host.querySelector("[data-editor-group-id='group/first'] .editor-tabs")).not.toBeNull();
    act(() => {
      pressWindowKey("keyup", "Control");
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keyup", "Control");
    });
    expect(firstActivations).toEqual(["/first-b.ts"]);
    expect(secondActivations).toEqual(["/second-b.ts"]);

    act(() => root.unmount());
    host.remove();
  });
});

function MonacoMount(): ReactNode {
  return <div className="monaco-editor" />;
}

function pressWindowKey(
  type: "keydown" | "keyup",
  key: string,
  init: KeyboardEventInit = {},
): void {
  window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key, ...init }));
}

function doc(path: string): EditorDocument {
  return { content: "", language: "typescript", name: path.slice(1), path, savedContent: "" };
}
