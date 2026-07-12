// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import { EditorTabs } from "./EditorTabs";
import { EDITOR_TAB_MIME } from "./editorTabDrag";

describe("EditorTabs", () => {
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

    const active = host.querySelector<HTMLButtonElement>(
      ".tab-main[aria-selected='true']",
    );

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
      host
        .querySelector<HTMLButtonElement>(".tab-main[aria-selected='false']")
        ?.click();
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
      host.querySelector(".editor-tab")?.dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
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
    vi.spyOn(tabs[1], "getBoundingClientRect").mockReturnValue(
      rectangle(100, 200),
    );

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
    vi.spyOn(tabs[1], "getBoundingClientRect").mockReturnValue(
      rectangle(100, 200),
    );

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
          documents={[
            doc("/workspace/src/App.tsx", "App.tsx"),
            doc(previewPath, "Preview.tsx"),
          ]}
          onActivate={activate}
          onClose={vi.fn()}
          onPin={pin}
          onReorder={reorder}
          previewPath={previewPath}
        />,
      );
    });

    const tabs = host.querySelectorAll<HTMLElement>(".editor-tab");
    vi.spyOn(tabs[0], "getBoundingClientRect").mockReturnValue(
      rectangle(0, 100),
    );

    act(() => {
      dispatchDragEvent(tabs[1], "dragstart", dataTransfer, 150);
      dispatchDragEvent(tabs[0], "dragover", dataTransfer, 25);
      dispatchDragEvent(tabs[0], "drop", dataTransfer, 25);
    });

    expect(reorder).toHaveBeenCalledWith(
      previewPath,
      "/workspace/src/App.tsx",
      "before",
    );
    expect(host.querySelector(".editor-tab.preview")?.textContent).toContain(
      "Preview.tsx",
    );
    expect(host.querySelector(".editor-tab.active")?.textContent).toContain(
      "App.tsx",
    );
    expect(activate).not.toHaveBeenCalled();
    expect(pin).toHaveBeenCalledWith(previewPath);
  });

  it("moves a tab between groups and accepts an empty strip drop", async () => {
    const move = vi.fn();
    const dataTransfer = createDataTransfer();
    dataTransfer.setData(EDITOR_TAB_MIME, JSON.stringify({
      version: 1,
      projectId: "project-a",
      sourceGroupId: "left",
      path: "/workspace/src/App.tsx",
    }));
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
        <EditorTabs activePath={null} documents={[]} groupId="right" onActivate={vi.fn()}
          onClose={vi.fn()} onMove={move} onPin={vi.fn()} previewPath={null} projectId="project-a" />,
      );
    });
    for (const payload of ["not-json", JSON.stringify({
      version: 1, projectId: "project-b", sourceGroupId: "left", path: "/foreign.ts",
    })]) {
      const dataTransfer = createDataTransfer();
      dataTransfer.setData(EDITOR_TAB_MIME, payload);
      act(() => dispatchDragEvent(host.querySelector(".editor-tabs")!, "drop", dataTransfer, 0));
    }
    expect(move).not.toHaveBeenCalled();
  });

  it("checks only MIME presence during dragover and reads data on drop", async () => {
    const reorder = vi.fn();
    const dataTransfer = createDataTransfer();
    dataTransfer.setData(EDITOR_TAB_MIME, JSON.stringify({
      version: 1,
      projectId: "project-a",
      sourceGroupId: "left",
      path: "/workspace/src/App.tsx",
    }));
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
});

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
