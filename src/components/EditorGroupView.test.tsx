// @vitest-environment jsdom

import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { EditorGroupView } from "./EditorGroupView";
import {
  WorkbenchEditorTabsPortalProvider,
  WorkbenchEditorTabsPortalTarget,
} from "./workbenchEditorTabsPortal";

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

  it("presents the active group's existing tabs in the Files header without remounting content", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();

    const render = (filesHeaderVisible: boolean, panelHidden = false) => {
      act(() =>
        root.render(
          <WorkbenchEditorTabsPortalProvider>
            <header hidden={panelHidden} id="files-header">
              {filesHeaderVisible && !panelHidden && <WorkbenchEditorTabsPortalTarget />}
            </header>
            <EditorGroupView
              active
              documents={[doc("/one.ts"), doc("/two.ts")]}
              group={{
                activePath: "/one.ts",
                openPaths: ["/one.ts", "/two.ts"],
                previewPath: null,
              }}
              groupId="group/a"
              onActivateGroup={vi.fn()}
              onActivateTab={onActivateTab}
              onCloseTab={onCloseTab}
              onMoveTab={vi.fn()}
              onPinTab={vi.fn()}
              onReorderTab={vi.fn()}
              projectId="project"
              renderContent={() => <MonacoMount />}
            />
          </WorkbenchEditorTabsPortalProvider>,
        ),
      );
    };

    render(true);
    const monaco = host.querySelector(".monaco-editor");
    expect(host.querySelectorAll(".editor-tabs")).toHaveLength(1);
    expect(host.querySelector("#files-header .editor-tabs")).not.toBeNull();
    expect(host.querySelector(".editor-group > .editor-tabs")).toBeNull();
    expect(host.querySelectorAll(".monaco-editor")).toHaveLength(1);

    click(host.querySelector<HTMLButtonElement>("[title='/two.ts']"));
    click(host.querySelector<HTMLButtonElement>("[aria-label='Close two.ts']"));
    expect(onActivateTab).toHaveBeenCalledWith("group/a", "/two.ts");
    expect(onCloseTab).toHaveBeenCalledWith("group/a", "/two.ts");

    render(true, true);
    expect(host.querySelector("#files-header .editor-tabs")).toBeNull();
    expect(host.querySelector(".editor-group > .editor-tabs")).not.toBeNull();
    expect(host.querySelector(".monaco-editor")).toBe(monaco);
    expect(host.querySelectorAll(".monaco-editor")).toHaveLength(1);

    render(true);
    expect(host.querySelector("#files-header .editor-tabs")).not.toBeNull();
    expect(host.querySelector(".editor-group > .editor-tabs")).toBeNull();
    expect(host.querySelector(".monaco-editor")).toBe(monaco);
    expect(host.querySelectorAll(".monaco-editor")).toHaveLength(1);

    render(false);
    expect(host.querySelector("#files-header .editor-tabs")).toBeNull();
    expect(host.querySelector(".editor-group > .editor-tabs")).not.toBeNull();
    expect(host.querySelector(".monaco-editor")).toBe(monaco);
    expect(host.querySelectorAll(".monaco-editor")).toHaveLength(1);

    act(() => root.unmount());
    host.remove();
  });

  it("keeps inactive group tabs with their group when the active group uses the Files header", () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    act(() =>
      root.render(
        <WorkbenchEditorTabsPortalProvider>
          <header id="files-header">
            <WorkbenchEditorTabsPortalTarget />
          </header>
          <EditorGroupView
            active={false}
            documents={[doc("/one.ts")]}
            group={{ activePath: "/one.ts", openPaths: ["/one.ts"], previewPath: null }}
            groupId="group/inactive"
            onActivateGroup={vi.fn()}
            onActivateTab={vi.fn()}
            onCloseTab={vi.fn()}
            onMoveTab={vi.fn()}
            onPinTab={vi.fn()}
            onReorderTab={vi.fn()}
            projectId="project"
            renderContent={() => null}
          />
        </WorkbenchEditorTabsPortalProvider>,
      ),
    );

    expect(host.querySelector("#files-header .editor-tabs")).toBeNull();
    expect(host.querySelector(".editor-group > .editor-tabs")).not.toBeNull();
    act(() => root.unmount());
  });

  it("keeps a newer portal claim when an older target releases", () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    const render = (first: boolean, second: boolean) => {
      act(() =>
        root.render(
          <WorkbenchEditorTabsPortalProvider>
            <header id="first-target">{first && <WorkbenchEditorTabsPortalTarget />}</header>
            <header id="second-target">{second && <WorkbenchEditorTabsPortalTarget />}</header>
            <EditorGroupView
              active
              documents={[doc("/one.ts")]}
              group={{ activePath: "/one.ts", openPaths: ["/one.ts"], previewPath: null }}
              groupId="group/a"
              onActivateGroup={vi.fn()}
              onActivateTab={vi.fn()}
              onCloseTab={vi.fn()}
              onMoveTab={vi.fn()}
              onPinTab={vi.fn()}
              onReorderTab={vi.fn()}
              projectId="project"
              renderContent={() => null}
            />
          </WorkbenchEditorTabsPortalProvider>,
        ),
      );
    };

    render(true, false);
    expect(host.querySelector("#first-target .editor-tabs")).not.toBeNull();
    render(true, true);
    expect(host.querySelector("#second-target .editor-tabs")).not.toBeNull();
    render(false, true);
    expect(host.querySelector("#second-target .editor-tabs")).not.toBeNull();
    expect(host.querySelectorAll(".editor-tabs")).toHaveLength(1);

    act(() => root.unmount());
  });

  it("keeps portaled MRU cycling bound to the exact active group", async () => {
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
        <WorkbenchEditorTabsPortalProvider>
          <header id="files-header">
            <WorkbenchEditorTabsPortalTarget />
          </header>
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
            />
          </div>
        </WorkbenchEditorTabsPortalProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    const firstEditor = host.querySelector<HTMLTextAreaElement>("[aria-label='First editor']");
    act(() => {
      firstEditor?.focus();
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });
    expect(host.querySelector("[aria-label='Open editors']")).not.toBeNull();

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
    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
    expect(firstActivations).toEqual(["/first-b.ts"]);
    act(() => pressWindowKey("keyup", "Control"));

    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));
    expect(host.querySelector("[aria-label='Open editors']")).not.toBeNull();
    await act(async () => {
      replaceActiveGroup(false);
      await Promise.resolve();
    });
    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
    expect(host.querySelectorAll("#files-header .editor-tabs")).toHaveLength(1);
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

function click(element: HTMLButtonElement | null): void {
  expect(element).not.toBeNull();
  act(() => element?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
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
