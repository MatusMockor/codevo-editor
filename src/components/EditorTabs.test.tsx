// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import { __resetOpenEditorsMruForTests } from "../application/useOpenEditorsMru";
import { EditorTabs } from "./EditorTabs";
import { EDITOR_TAB_MIME } from "./editorTabDrag";

describe("EditorTabs", () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    __resetOpenEditorsMruForTests();
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the empty placeholder when there are no documents", async () => {
    await act(async () => {
      root.render(
        <EditorTabs
          activePath={null}
          documents={[]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={vi.fn()}
          onReorder={vi.fn()}
          previewPath={null}
        />,
      );
    });

    const tabs = host.querySelector(".editor-tabs");

    expect(tabs).not.toBeNull();
    expect(tabs?.classList.contains("empty")).toBe(true);
    expect(host.querySelectorAll(".editor-tab")).toHaveLength(0);
  });

  it("renders one tab per document and marks the active one", async () => {
    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[
            doc("/workspace/src/App.tsx", "App.tsx"),
            doc("/workspace/src/main.tsx", "main.tsx"),
          ]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={vi.fn()}
          onReorder={vi.fn()}
          previewPath={null}
        />,
      );
    });

    const tabs = [...host.querySelectorAll(".editor-tab")];

    expect(tabs).toHaveLength(2);
    expect(host.textContent).toContain("App.tsx");
    expect(host.textContent).toContain("main.tsx");

    const active = host.querySelector<HTMLButtonElement>(".tab-main[aria-selected='true']");

    expect(active?.textContent).toContain("App.tsx");
  });

  it("marks a dirty document with the changed class", async () => {
    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[doc("/workspace/src/App.tsx", "App.tsx", "edited")]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={vi.fn()}
          onReorder={vi.fn()}
          previewPath={null}
        />,
      );
    });

    expect(host.querySelector(".editor-tab.changed")).not.toBeNull();
    expect(host.querySelector(".dirty-dot")).not.toBeNull();
  });

  it("renders a Markdown preview as a clean non-text tab", async () => {
    const preview: MarkdownPreviewTab = {
      content: "# Preview",
      html: "<h1>Preview</h1>",
      name: "README.md Preview",
      path: "mockor-markdown-preview:/workspace/README.md",
      sourcePath: "/workspace/README.md",
    };

    await act(async () => {
      root.render(
        <EditorTabs
          activePath={preview.path}
          documents={[preview]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={vi.fn()}
          onReorder={vi.fn()}
          previewPath={null}
        />,
      );
    });

    expect(host.textContent).toContain("README.md Preview");
    expect(host.querySelector(".editor-tab.changed")).toBeNull();
    expect(host.querySelector(".dirty-dot")).toBeNull();
  });

  it("activates a tab when its main button is clicked", async () => {
    const activate = vi.fn();

    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[
            doc("/workspace/src/App.tsx", "App.tsx"),
            doc("/workspace/src/main.tsx", "main.tsx"),
          ]}
          onActivate={activate}
          onClose={vi.fn()}
          onPin={vi.fn()}
          onReorder={vi.fn()}
          previewPath={null}
        />,
      );
    });

    act(() => {
      host.querySelector<HTMLButtonElement>(".tab-main[aria-selected='false']")?.click();
    });

    expect(activate).toHaveBeenCalledWith("/workspace/src/main.tsx");
  });

  it("pins a document on double click", async () => {
    const pin = vi.fn();

    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[doc("/workspace/src/App.tsx", "App.tsx")]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={pin}
          onReorder={vi.fn()}
          previewPath="/workspace/src/App.tsx"
        />,
      );
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>(".tab-main")
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(pin).toHaveBeenCalledWith("/workspace/src/App.tsx");
  });

  it("closes a document with a middle click", async () => {
    const close = vi.fn();

    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[doc("/workspace/src/App.tsx", "App.tsx")]}
          onActivate={vi.fn()}
          onClose={close}
          onPin={vi.fn()}
          onReorder={vi.fn()}
          previewPath={null}
        />,
      );
    });

    act(() => {
      host
        .querySelector(".editor-tab")
        ?.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    });

    expect(close).toHaveBeenCalledWith("/workspace/src/App.tsx");
  });

  it("does not re-render when the parent re-renders with identical props", async () => {
    // The component maps over `documents` for every render, so spying on the
    // array's `map` counts how often the memoized subtree renders.
    const documents = [
      doc("/workspace/src/App.tsx", "App.tsx"),
      doc("/workspace/src/main.tsx", "main.tsx"),
    ];
    const mapSpy = vi.spyOn(documents, "map");
    const stableProps: React.ComponentProps<typeof EditorTabs> = {
      activePath: "/workspace/src/App.tsx",
      documents,
      onActivate: vi.fn(),
      onClose: vi.fn(),
      onPin: vi.fn(),
      onReorder: vi.fn(),
      previewPath: null,
    };

    let forceParentRender: (value: number) => void = () => undefined;

    function Parent() {
      const [, setTick] = useState(0);
      forceParentRender = setTick;
      return <EditorTabs {...stableProps} />;
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    const callsAfterMount = mapSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    await act(async () => {
      forceParentRender(1);
      await Promise.resolve();
    });

    // React.memo prevents the component from re-rendering when every prop is
    // referentially unchanged, so `documents` is never mapped again.
    expect(mapSpy.mock.calls.length).toBe(callsAfterMount);

    mapSpy.mockRestore();
  });

  it("reorders before a tab when dropped over its left half", async () => {
    const reorder = vi.fn();
    const dataTransfer = createDataTransfer();

    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[
            doc("/workspace/src/App.tsx", "App.tsx"),
            doc("/workspace/src/main.tsx", "main.tsx"),
          ]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={vi.fn()}
          onReorder={reorder}
          previewPath={null}
        />,
      );
    });

    const tabs = host.querySelectorAll<HTMLElement>(".editor-tab");
    vi.spyOn(tabs[1], "getBoundingClientRect").mockReturnValue(rectangle(100, 200));

    act(() => {
      dispatchDragEvent(tabs[0], "dragstart", dataTransfer, 10);
      dispatchDragEvent(tabs[1], "dragover", dataTransfer, 125);
    });

    expect(tabs[1].classList.contains("drop-before")).toBe(true);

    act(() => {
      dispatchDragEvent(tabs[1], "drop", dataTransfer, 125);
    });

    expect(reorder).toHaveBeenCalledWith(
      "/workspace/src/App.tsx",
      "/workspace/src/main.tsx",
      "before",
    );
  });

  it("reorders after a tab when dropped over its right half", async () => {
    const reorder = vi.fn();
    const dataTransfer = createDataTransfer();

    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[
            doc("/workspace/src/App.tsx", "App.tsx"),
            doc("/workspace/src/main.tsx", "main.tsx"),
          ]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={vi.fn()}
          onReorder={reorder}
          previewPath={null}
        />,
      );
    });

    const tabs = host.querySelectorAll<HTMLElement>(".editor-tab");
    vi.spyOn(tabs[1], "getBoundingClientRect").mockReturnValue(rectangle(100, 200));

    act(() => {
      dispatchDragEvent(tabs[0], "dragstart", dataTransfer, 10);
      dispatchDragEvent(tabs[1], "dragover", dataTransfer, 175);
      dispatchDragEvent(tabs[1], "drop", dataTransfer, 175);
    });

    expect(reorder).toHaveBeenCalledWith(
      "/workspace/src/App.tsx",
      "/workspace/src/main.tsx",
      "after",
    );
  });

  it("pins a preview when dragging it while keeping active state unchanged", async () => {
    const activate = vi.fn();
    const pin = vi.fn();
    const reorder = vi.fn();
    const dataTransfer = createDataTransfer();
    const previewPath = "/workspace/src/Preview.tsx";

    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[doc("/workspace/src/App.tsx", "App.tsx"), doc(previewPath, "Preview.tsx")]}
          onActivate={activate}
          onClose={vi.fn()}
          onPin={pin}
          onReorder={reorder}
          previewPath={previewPath}
        />,
      );
    });

    const tabs = host.querySelectorAll<HTMLElement>(".editor-tab");
    vi.spyOn(tabs[0], "getBoundingClientRect").mockReturnValue(rectangle(0, 100));

    act(() => {
      dispatchDragEvent(tabs[1], "dragstart", dataTransfer, 150);
      dispatchDragEvent(tabs[0], "dragover", dataTransfer, 25);
      dispatchDragEvent(tabs[0], "drop", dataTransfer, 25);
    });

    expect(reorder).toHaveBeenCalledWith(previewPath, "/workspace/src/App.tsx", "before");
    expect(host.querySelector(".editor-tab.preview")?.textContent).toContain("Preview.tsx");
    expect(host.querySelector(".editor-tab.active")?.textContent).toContain("App.tsx");
    expect(activate).not.toHaveBeenCalled();
    expect(pin).toHaveBeenCalledWith(previewPath);
  });

  it("moves a tab between groups and accepts an empty strip drop", async () => {
    const move = vi.fn();
    const dataTransfer = createDataTransfer();
    dataTransfer.setData(
      EDITOR_TAB_MIME,
      JSON.stringify({
        version: 1,
        projectId: "project-a",
        sourceGroupId: "left",
        path: "/workspace/src/App.tsx",
      }),
    );
    await act(async () => {
      root.render(
        <EditorTabs
          activePath={null}
          documents={[]}
          groupId="right"
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onMove={move}
          onPin={vi.fn()}
          previewPath={null}
          projectId="project-a"
        />,
      );
    });
    act(() => dispatchDragEvent(host.querySelector(".editor-tabs")!, "drop", dataTransfer, 0));
    expect(move).toHaveBeenCalledWith("left", "right", "/workspace/src/App.tsx");
  });

  it("rejects malformed and cross-project drops", async () => {
    const move = vi.fn();
    await act(async () => {
      root.render(
        <EditorTabs
          activePath={null}
          documents={[]}
          groupId="right"
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onMove={move}
          onPin={vi.fn()}
          previewPath={null}
          projectId="project-a"
        />,
      );
    });
    for (const payload of [
      "not-json",
      JSON.stringify({
        version: 1,
        projectId: "project-b",
        sourceGroupId: "left",
        path: "/foreign.ts",
      }),
    ]) {
      const dataTransfer = createDataTransfer();
      dataTransfer.setData(EDITOR_TAB_MIME, payload);
      act(() => dispatchDragEvent(host.querySelector(".editor-tabs")!, "drop", dataTransfer, 0));
    }
    expect(move).not.toHaveBeenCalled();
  });

  it("checks only MIME presence during dragover and reads data on drop", async () => {
    const reorder = vi.fn();
    const dataTransfer = createDataTransfer();
    dataTransfer.setData(
      EDITOR_TAB_MIME,
      JSON.stringify({
        version: 1,
        projectId: "project-a",
        sourceGroupId: "left",
        path: "/workspace/src/App.tsx",
      }),
    );
    const getData = vi.spyOn(dataTransfer, "getData");
    await act(async () => {
      root.render(
        <EditorTabs
          activePath="/workspace/src/App.tsx"
          documents={[
            doc("/workspace/src/App.tsx", "App.tsx"),
            doc("/workspace/src/main.tsx", "main.tsx"),
          ]}
          groupId="left"
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={vi.fn()}
          onReorder={reorder}
          previewPath={null}
          projectId="project-a"
        />,
      );
    });
    const target = host.querySelectorAll<HTMLElement>(".editor-tab")[1];
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rectangle(100, 200));
    act(() => dispatchDragEvent(target, "dragover", dataTransfer, 125));
    expect(getData).not.toHaveBeenCalled();
    act(() => dispatchDragEvent(target, "drop", dataTransfer, 125));
    expect(getData).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith(
      "/workspace/src/App.tsx",
      "/workspace/src/main.tsx",
      "before",
    );
  });

  it("cycles open editors in MRU order instead of positional order", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts", "/workspace/C.ts"];
    const activate = vi.fn();

    function Harness() {
      const [activePath, setActivePath] = useState(paths[0]);
      const handleActivate = (path: string) => {
        activate(path);
        setActivePath(path);
      };
      return (
        <section className="editor-group active">
          <EditorTabs
            activePath={activePath}
            documents={paths.map((path) => doc(path, path.slice(11)))}
            groupId="main"
            onActivate={handleActivate}
            onClose={vi.fn()}
            onPin={vi.fn()}
            previewPath={null}
          />
          <div className="editor-panel" />
        </section>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    clickTab(host, "C.ts");
    clickTab(host, "A.ts");

    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));

    expect(selectedSwitcherName(host)).toBe("C.ts");

    act(() => pressWindowKey("keyup", "Control"));

    expect(activate).toHaveBeenLastCalledWith(paths[2]);
  });

  it("advances to the third-most-recent editor while Control remains held", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts", "/workspace/C.ts"];
    const activate = vi.fn();

    await renderStatefulTabs(root, paths, activate);
    clickTab(host, "C.ts");
    clickTab(host, "A.ts");

    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });

    expect(selectedSwitcherName(host)).toBe("B.ts");

    act(() => pressWindowKey("keyup", "Control"));

    expect(activate).toHaveBeenLastCalledWith(paths[1]);
  });

  it("announces and scrolls the highlighted editor while cycling beyond the viewport", async () => {
    const paths = Array.from({ length: 16 }, (_, index) => `/workspace/Editor${index + 1}.ts`);

    await renderStatefulTabs(root, paths, vi.fn());
    act(() => {
      for (let index = 0; index < 12; index += 1) {
        pressWindowKey("keydown", "Tab", { ctrlKey: true });
      }
    });

    expect(selectedSwitcherName(host)).toBe("Editor13.ts");
    expect(host.querySelector("[role='status']")?.textContent).toBe("Editor13.ts");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(host.querySelector(".palette-footer")?.textContent).toContain("release ctrl to open");
    expect(host.querySelector(".palette-footer")?.textContent).not.toContain("navigate");
  });

  it("cycles backward through open-editor MRU with Ctrl+Shift+Tab", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts", "/workspace/C.ts"];
    const activate = vi.fn();

    await renderStatefulTabs(root, paths, activate);
    clickTab(host, "C.ts");
    clickTab(host, "A.ts");
    act(() =>
      pressWindowKey("keydown", "Tab", {
        ctrlKey: true,
        shiftKey: true,
      }),
    );

    expect(selectedSwitcherName(host)).toBe("B.ts");

    act(() => pressWindowKey("keyup", "Control"));

    expect(activate).toHaveBeenLastCalledWith(paths[1]);
  });

  it("commits on Control release and promotes the selected editor in MRU order", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts", "/workspace/C.ts", "/workspace/D.ts"];
    const activate = vi.fn();

    await renderStatefulTabs(root, paths, activate);
    clickTab(host, "B.ts");
    clickTab(host, "C.ts");
    clickTab(host, "A.ts");
    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keyup", "Control");
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });

    expect(selectedSwitcherName(host)).toBe("A.ts");
    expect(activate).toHaveBeenLastCalledWith(paths[2]);
  });

  it("cancels on Escape and keeps the original editor active", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts", "/workspace/C.ts"];
    const activate = vi.fn();

    await renderStatefulTabs(root, paths, activate);
    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keydown", "Escape", { ctrlKey: true });
    });

    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
    expect(host.querySelector(".tab-main[aria-selected='true']")?.textContent).toContain("A.ts");
    expect(activate).not.toHaveBeenCalled();
  });

  it("removes the highlighted editor mid-cycle without corrupting MRU order", async () => {
    const initialPaths = [
      "/workspace/A.ts",
      "/workspace/B.ts",
      "/workspace/C.ts",
      "/workspace/D.ts",
    ];
    const activate = vi.fn();

    function Harness() {
      const [paths, setPaths] = useState(initialPaths);
      const [activePath, setActivePath] = useState(initialPaths[0]);
      const handleActivate = (path: string) => {
        activate(path);
        setActivePath(path);
      };
      return (
        <section className="editor-group active">
          <EditorTabs
            activePath={activePath}
            documents={paths.map((path) => doc(path, path.slice(11)))}
            groupId="main"
            onActivate={handleActivate}
            onClose={(path) => setPaths((current) => current.filter((item) => item !== path))}
            onPin={vi.fn()}
            previewPath={null}
          />
          <div className="editor-panel" />
        </section>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    clickTab(host, "B.ts");
    clickTab(host, "D.ts");
    clickTab(host, "A.ts");
    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });
    expect(selectedSwitcherName(host)).toBe("D.ts");
    act(() => {
      findButton(host, "Close D.ts").click();
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keyup", "Control");
    });

    expect(switcherNames(host)).toEqual([]);
    expect(activate).toHaveBeenLastCalledWith("/workspace/B.ts");
  });

  it("focuses the newly activated surface when a commit replaces the previous surface", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    function Harness() {
      const [activePath, setActivePath] = useState(paths[0]);
      return (
        <section className="editor-group active">
          <EditorTabs
            activePath={activePath}
            documents={paths.map((path) => doc(path, path.slice(11)))}
            onActivate={setActivePath}
            onClose={vi.fn()}
            onPin={vi.fn()}
            previewPath={null}
          />
          <div className="editor-panel">
            {activePath === paths[0] ? (
              <textarea aria-label="A editor" className="inputarea" />
            ) : (
              <section aria-label="B preview" />
            )}
          </div>
        </section>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    const editor = host.querySelector<HTMLTextAreaElement>("[aria-label='A editor']");
    act(() => editor?.focus());

    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keyup", "Control");
    });

    expect(host.querySelector("[aria-label='B preview']")).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector(".editor-panel"));
    expect(host.querySelector(".editor-panel")?.getAttribute("tabindex")).toBe("-1");
  });

  it("restores editor focus when committing the already-active MRU entry", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    await renderStatefulTabs(root, paths, vi.fn());
    const editor = document.createElement("textarea");
    editor.className = "inputarea";
    host.querySelector(".editor-panel")?.append(editor);
    act(() => {
      editor.focus();
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });
    const activeEntry = [...host.querySelectorAll<HTMLButtonElement>("[role='option']")].find(
      (entry) => entry.textContent?.includes("A.ts"),
    );
    expect(activeEntry).toBeDefined();

    act(() => {
      activeEntry?.focus();
      activeEntry?.click();
    });

    expect(document.activeElement).toBe(editor);

    const outside = document.createElement("button");
    host.append(outside);
    act(() => {
      outside.focus();
      clickTab(host, "B.ts");
      clickTab(host, "A.ts");
    });
    expect(document.activeElement).toBe(outside);
  });

  it("restores editor focus after MRU cycling wraps to the active editor", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    await renderStatefulTabs(root, paths, vi.fn());
    const editor = document.createElement("textarea");
    editor.className = "inputarea";
    host.querySelector(".editor-panel")?.append(editor);
    act(() => {
      editor.focus();
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });
    const highlightedEntry = host.querySelector<HTMLButtonElement>(
      "[aria-label='Open editors'] [aria-selected='true']",
    );
    act(() => {
      highlightedEntry?.focus();
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keyup", "Control");
    });

    expect(document.activeElement).toBe(editor);
  });

  it("cancels and restores focus when the window blurs", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    await renderStatefulTabs(root, paths, vi.fn());
    const editor = document.createElement("textarea");
    host.querySelector(".editor-panel")?.append(editor);
    act(() => editor.focus());
    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));
    act(() => window.dispatchEvent(new Event("blur")));

    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
    expect(document.activeElement).toBe(editor);
  });

  it("dismisses Escape cycling until Control is released", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    await renderStatefulTabs(root, paths, vi.fn());
    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keydown", "Escape", { ctrlKey: true });
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });
    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();

    act(() => {
      pressWindowKey("keyup", "Control");
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });
    expect(host.querySelector("[aria-label='Open editors']")).not.toBeNull();
  });

  it("clears an open session when the MRU scope changes without a remount", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    function Harness({ projectId }: { projectId: string }) {
      return (
        <section className="editor-group active">
          <EditorTabs
            activePath={paths[0]}
            documents={paths.map((path) => doc(path, path.slice(11)))}
            onActivate={vi.fn()}
            onClose={vi.fn()}
            onPin={vi.fn()}
            previewPath={null}
            projectId={projectId}
          />
          <div className="editor-panel" />
        </section>
      );
    }

    await act(async () => root.render(<Harness projectId="/workspace-one" />));
    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));
    expect(host.querySelector("[aria-label='Open editors']")).not.toBeNull();

    await act(async () => root.render(<Harness projectId="/workspace-two" />));
    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
  });

  it("keeps one MRU scope for trailing-separator workspace aliases", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    function Harness({ projectId }: { projectId: string }) {
      return (
        <section className="editor-group active">
          <EditorTabs
            activePath={paths[0]}
            documents={paths.map((path) => doc(path, path.slice(11)))}
            onActivate={vi.fn()}
            onClose={vi.fn()}
            onPin={vi.fn()}
            previewPath={null}
            projectId={projectId}
          />
          <div className="editor-panel" />
        </section>
      );
    }

    await act(async () => root.render(<Harness projectId="/workspace" />));
    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));
    await act(async () => root.render(<Harness projectId="/workspace/" />));

    expect(host.querySelector("[aria-label='Open editors']")).not.toBeNull();
  });

  it("resets retained default-scope MRU state between harnesses", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts", "/workspace/C.ts"];

    function Harness() {
      const [activePath, setActivePath] = useState(paths[0]);
      return (
        <section className="editor-group active">
          <EditorTabs
            activePath={activePath}
            documents={paths.map((path) => doc(path, path.slice(11)))}
            onActivate={setActivePath}
            onClose={vi.fn()}
            onPin={vi.fn()}
            previewPath={null}
          />
          <div className="editor-panel" />
        </section>
      );
    }

    await act(async () => root.render(<Harness />));
    clickTab(host, "C.ts");
    clickTab(host, "A.ts");
    await act(async () => root.render(<div />));
    __resetOpenEditorsMruForTests();
    await act(async () => root.render(<Harness />));
    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));

    expect(selectedSwitcherName(host)).toBe("B.ts");
  });

  it("removes listeners and dismisses the session when unmounted", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];
    const activate = vi.fn();

    await renderStatefulTabs(root, paths, activate);
    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));
    await act(async () => root.render(<div>replacement</div>));
    act(() => {
      pressWindowKey("keyup", "Control");
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });

    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
    expect(activate).not.toHaveBeenCalled();
  });

  it("accepts editor input events and ignores events from an active modal", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    await renderStatefulTabs(root, paths, vi.fn());
    const input = document.createElement("input");
    host.querySelector(".editor-panel")?.append(input);
    act(() => dispatchKey(input, "keydown", "Tab", { ctrlKey: true }));
    expect(host.querySelector("[aria-label='Open editors']")).not.toBeNull();
    act(() => pressWindowKey("keydown", "Escape", { ctrlKey: true }));
    act(() => pressWindowKey("keyup", "Control"));

    const modal = document.createElement("section");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("role", "dialog");
    const modalInput = document.createElement("input");
    modal.append(modalInput);
    host.append(modal);
    act(() => dispatchKey(modalInput, "keydown", "Tab", { ctrlKey: true }));

    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
  });

  it.each([
    ["Command palette", "Command palette"],
    ["Quick Open", "Quick open"],
    ["workspace symbols", "Go to symbol in workspace"],
    ["file structure", "File structure"],
  ])("ignores Ctrl+Tab inside the %s floating surface", async (_name, ariaLabel) => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts"];

    await renderStatefulTabs(root, paths, vi.fn());
    const surface = document.createElement("section");
    surface.setAttribute("aria-label", ariaLabel);
    const input = document.createElement("input");
    surface.append(input);
    host.append(surface);
    act(() => dispatchKey(input, "keydown", "Tab", { ctrlKey: true }));

    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
  });

  it("switches only within the active editor group", async () => {
    const leftActivate = vi.fn();
    const rightActivate = vi.fn();

    await act(async () => {
      root.render(
        <>
          <section className="editor-group" data-editor-group-id="left">
            <EditorTabs
              activePath="/workspace/LeftA.ts"
              documents={[
                doc("/workspace/LeftA.ts", "LeftA.ts"),
                doc("/workspace/LeftB.ts", "LeftB.ts"),
              ]}
              groupId="left"
              onActivate={leftActivate}
              onClose={vi.fn()}
              onPin={vi.fn()}
              previewPath={null}
              projectId="/workspace-groups"
            />
          </section>
          <section className="editor-group active" data-editor-group-id="right">
            <EditorTabs
              activePath="/workspace/RightA.ts"
              documents={[
                doc("/workspace/RightA.ts", "RightA.ts"),
                doc("/workspace/RightB.ts", "RightB.ts"),
              ]}
              groupId="right"
              onActivate={rightActivate}
              onClose={vi.fn()}
              onPin={vi.fn()}
              previewPath={null}
              projectId="/workspace-groups"
            />
          </section>
        </>,
      );
    });

    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keyup", "Control");
    });

    expect(rightActivate).toHaveBeenCalledWith("/workspace/RightB.ts");
    expect(leftActivate).not.toHaveBeenCalled();
  });

  it("cancels the originating MRU session when another editor group becomes active", async () => {
    const leftActivate = vi.fn();
    const rightActivate = vi.fn();
    let activateGroup: ((group: "left" | "right") => void) | undefined;

    function Harness() {
      const [activeGroup, setActiveGroup] = useState<"left" | "right">("left");
      activateGroup = setActiveGroup;
      return (
        <>
          <section className={`editor-group${activeGroup === "left" ? " active" : ""}`}>
            <EditorTabs
              activePath="/workspace/LeftA.ts"
              documents={[
                doc("/workspace/LeftA.ts", "LeftA.ts"),
                doc("/workspace/LeftB.ts", "LeftB.ts"),
              ]}
              groupId="left"
              onActivate={leftActivate}
              onClose={vi.fn()}
              onPin={vi.fn()}
              previewPath={null}
              projectId="/workspace-groups"
            />
            <div className="editor-panel">
              <textarea aria-label="Left editor" className="inputarea" />
            </div>
          </section>
          <section className={`editor-group${activeGroup === "right" ? " active" : ""}`}>
            <EditorTabs
              activePath="/workspace/RightA.ts"
              documents={[
                doc("/workspace/RightA.ts", "RightA.ts"),
                doc("/workspace/RightB.ts", "RightB.ts"),
              ]}
              groupId="right"
              onActivate={rightActivate}
              onClose={vi.fn()}
              onPin={vi.fn()}
              previewPath={null}
              projectId="/workspace-groups"
            />
            <div className="editor-panel">
              <textarea aria-label="Right editor" className="inputarea" />
            </div>
          </section>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    act(() => {
      host.querySelector<HTMLTextAreaElement>("[aria-label='Left editor']")?.focus();
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
    });
    expect(host.querySelector("[aria-label='Open editors']")).not.toBeNull();

    await act(async () => {
      activateGroup?.("right");
      await Promise.resolve();
    });

    expect(host.querySelector("[aria-label='Open editors']")).toBeNull();
    expect(document.activeElement).toBe(
      host.querySelector<HTMLTextAreaElement>("[aria-label='Right editor']"),
    );
    act(() => pressWindowKey("keyup", "Control"));
    expect(leftActivate).not.toHaveBeenCalled();
    expect(rightActivate).not.toHaveBeenCalled();
  });

  it("commits only the new active group after switching groups while Control is held", async () => {
    const leftActivate = vi.fn();
    const rightActivate = vi.fn();
    let activateGroup: ((group: "left" | "right") => void) | undefined;

    function Harness() {
      const [activeGroup, setActiveGroup] = useState<"left" | "right">("left");
      activateGroup = setActiveGroup;
      return (
        <>
          <section className={`editor-group${activeGroup === "left" ? " active" : ""}`}>
            <EditorTabs
              activePath="/workspace/LeftA.ts"
              documents={[
                doc("/workspace/LeftA.ts", "LeftA.ts"),
                doc("/workspace/LeftB.ts", "LeftB.ts"),
              ]}
              groupId="left"
              onActivate={leftActivate}
              onClose={vi.fn()}
              onPin={vi.fn()}
              previewPath={null}
              projectId="/workspace-groups"
            />
            <div className="editor-panel" />
          </section>
          <section className={`editor-group${activeGroup === "right" ? " active" : ""}`}>
            <EditorTabs
              activePath="/workspace/RightA.ts"
              documents={[
                doc("/workspace/RightA.ts", "RightA.ts"),
                doc("/workspace/RightB.ts", "RightB.ts"),
              ]}
              groupId="right"
              onActivate={rightActivate}
              onClose={vi.fn()}
              onPin={vi.fn()}
              previewPath={null}
              projectId="/workspace-groups"
            />
            <div className="editor-panel" />
          </section>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));
    await act(async () => {
      activateGroup?.("right");
      await Promise.resolve();
    });
    act(() => {
      pressWindowKey("keydown", "Tab", { ctrlKey: true });
      pressWindowKey("keyup", "Control");
    });

    expect(leftActivate).not.toHaveBeenCalled();
    expect(rightActivate).toHaveBeenCalledTimes(1);
    expect(rightActivate).toHaveBeenCalledWith("/workspace/RightB.ts");
  });

  it("isolates and restores MRU order per workspace root", async () => {
    const paths = ["/workspace/A.ts", "/workspace/B.ts", "/workspace/C.ts"];

    function Workspace({ projectId }: { projectId: string }) {
      const [activePath, setActivePath] = useState(paths[0]);
      return (
        <section className="editor-group active">
          <EditorTabs
            activePath={activePath}
            documents={paths.map((path) => doc(path, path.slice(11)))}
            groupId="main"
            onActivate={setActivePath}
            onClose={vi.fn()}
            onPin={vi.fn()}
            previewPath={null}
            projectId={projectId}
          />
          <div className="editor-panel" />
        </section>
      );
    }

    await act(async () => {
      root.render(<Workspace projectId="/workspace-one" />);
    });
    clickTab(host, "C.ts");
    clickTab(host, "A.ts");

    await act(async () => {
      root.render(<Workspace projectId="/workspace-two" />);
    });
    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));
    expect(selectedSwitcherName(host)).toBe("B.ts");
    act(() => {
      pressWindowKey("keydown", "Escape", { ctrlKey: true });
      pressWindowKey("keyup", "Control");
    });

    await act(async () => {
      root.render(<Workspace projectId="/workspace-one" />);
    });
    act(() => pressWindowKey("keydown", "Tab", { ctrlKey: true }));

    expect(selectedSwitcherName(host)).toBe("C.ts");
  });
});

async function renderStatefulTabs(root: Root, paths: string[], activate: (path: string) => void) {
  function Harness() {
    const [activePath, setActivePath] = useState(paths[0]);
    const handleActivate = (path: string) => {
      activate(path);
      setActivePath(path);
    };
    return (
      <section className="editor-group active">
        <EditorTabs
          activePath={activePath}
          documents={paths.map((path) => doc(path, path.slice(11)))}
          groupId="main"
          onActivate={handleActivate}
          onClose={vi.fn()}
          onPin={vi.fn()}
          previewPath={null}
        />
        <div className="editor-panel" />
      </section>
    );
  }

  await act(async () => {
    root.render(<Harness />);
  });
}

function clickTab(host: HTMLElement, name: string) {
  act(() => {
    findButton(host, name).click();
  });
}

function findButton(host: HTMLElement, name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.textContent?.includes(name) || candidate.getAttribute("aria-label") === name,
  );
  expect(button).toBeDefined();
  return button!;
}

function pressWindowKey(type: "keydown" | "keyup", key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key, ...init }));
}

function dispatchKey(
  target: Element,
  type: "keydown" | "keyup",
  key: string,
  init: KeyboardEventInit = {},
) {
  target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key, ...init }));
}

function switcherNames(host: HTMLElement): string[] {
  return [...host.querySelectorAll("[aria-label='Open editors'] strong")].map(
    (node) => node.textContent ?? "",
  );
}

function selectedSwitcherName(host: HTMLElement): string | undefined {
  return (
    host.querySelector("[aria-label='Open editors'] [aria-selected='true'] strong")?.textContent ??
    undefined
  );
}

function createDataTransfer() {
  const values = new Map<string, string>();

  return {
    dropEffect: "move",
    effectAllowed: "move",
    get types() {
      return [...values.keys()];
    },
    getData(type: string) {
      return values.get(type) ?? "";
    },
    setData(type: string, value: string) {
      values.set(type, value);
    },
  };
}

function dispatchDragEvent(
  target: Element,
  type: string,
  dataTransfer: ReturnType<typeof createDataTransfer>,
  clientX: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    dataTransfer: { value: dataTransfer },
  });
  target.dispatchEvent(event);
}

function rectangle(left: number, right: number): DOMRect {
  return {
    bottom: 34,
    height: 34,
    left,
    right,
    top: 0,
    width: right - left,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

function doc(
  path: string,
  name: string,
  content = "saved",
  savedContent = "saved",
): EditorDocument {
  return {
    content,
    language: "typescript",
    name,
    path,
    savedContent,
  };
}
