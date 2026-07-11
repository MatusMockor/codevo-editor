// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import { EditorTabs } from "./EditorTabs";

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
});

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
