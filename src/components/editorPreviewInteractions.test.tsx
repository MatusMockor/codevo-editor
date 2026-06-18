// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument, FileEntry } from "../domain/workspace";
import { EditorTabs } from "./EditorTabs";
import { FileTree } from "./FileTree";

describe("editor preview interactions", () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("marks preview tabs and pins them on double click", () => {
    const document = editorDocument("/workspace/src/User.php", "User.php");
    const onPin = vi.fn();

    act(() => {
      root.render(
        <EditorTabs
          activePath={document.path}
          documents={[document]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={onPin}
          previewPath={document.path}
        />,
      );
    });

    expect(queryRequired(host, ".editor-tab").classList.contains("preview")).toBe(
      true,
    );

    act(() => {
      queryRequired<HTMLButtonElement>(host, "button[role='tab']").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      );
    });

    expect(onPin).toHaveBeenCalledWith(document.path);
  });

  it("marks changed tabs separately from preview tabs", () => {
    const document = {
      ...editorDocument("/workspace/src/User.php", "User.php"),
      content: "<?php echo 'changed';",
      savedContent: "<?php echo 'saved';",
    };

    act(() => {
      root.render(
        <EditorTabs
          activePath={document.path}
          documents={[document]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onPin={vi.fn()}
          previewPath={document.path}
        />,
      );
    });

    const tab = queryRequired(host, ".editor-tab");
    expect(tab.classList.contains("changed")).toBe(true);
    expect(tab.classList.contains("preview")).toBe(false);
  });

  it("closes file tabs with a middle click", () => {
    const document = editorDocument("/workspace/src/User.php", "User.php");
    const onClose = vi.fn();

    act(() => {
      root.render(
        <EditorTabs
          activePath={document.path}
          documents={[document]}
          onActivate={vi.fn()}
          onClose={onClose}
          onPin={vi.fn()}
          previewPath={null}
        />,
      );
    });

    act(() => {
      queryRequired(host, ".editor-tab").dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
    });

    expect(onClose).toHaveBeenCalledWith(document.path);
  });

  it("previews files on single click and opens them on double click", () => {
    const file = fileEntry("/workspace/src/User.php", "User.php", "file");
    const onPreviewFile = vi.fn();
    const onOpenFile = vi.fn();

    renderFileTree({
      file,
      onOpenFile,
      onPreviewFile,
    });

    const row = queryRequired<HTMLButtonElement>(host, ".tree-row");

    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });

    expect(onPreviewFile).toHaveBeenCalledWith(file);
    expect(onOpenFile).not.toHaveBeenCalled();

    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
      row.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
      );
    });

    expect(onPreviewFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith(file);
  });

  it("keeps PHP files as files instead of expanding class symbols in the file tree", () => {
    const file = fileEntry("/workspace/src/User.php", "User.php", "file");
    const onPreviewFile = vi.fn();

    renderFileTree({
      file,
      onPreviewFile,
    });

    const row = queryRequired<HTMLButtonElement>(host, ".tree-row");

    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });

    expect(row.getAttribute("aria-expanded")).toBeNull();
    expect(onPreviewFile).toHaveBeenCalledWith(file);
    expect(host.querySelector(".php-file-outline-row")).toBeNull();
  });

  it("does not immediately collapse directories on double click", () => {
    const directory = fileEntry("/workspace/src", "src", "directory");
    const onToggleDirectory = vi.fn();

    renderFileTree({
      file: directory,
      onToggleDirectory,
    });

    const row = queryRequired<HTMLButtonElement>(host, ".tree-row");

    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
      row.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
      );
    });

    expect(onToggleDirectory).toHaveBeenCalledTimes(1);
    expect(onToggleDirectory).toHaveBeenCalledWith(directory.path);
  });

  it("scrolls the active file into view when reveal is enabled", () => {
    const file = fileEntry("/workspace/src/User.php", "User.php", "file");

    renderFileTree({
      activePath: file.path,
      file,
      revealActivePath: true,
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("does not scroll the active file when reveal is disabled", () => {
    const file = fileEntry("/workspace/src/User.php", "User.php", "file");

    renderFileTree({
      activePath: file.path,
      file,
      revealActivePath: false,
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls the active file again when the reveal signal changes", () => {
    const file = fileEntry("/workspace/src/User.php", "User.php", "file");

    renderFileTree({
      activePath: file.path,
      file,
      revealActivePath: true,
      revealActivePathSignal: 0,
    });
    scrollIntoView.mockClear();
    renderFileTree({
      activePath: file.path,
      file,
      revealActivePath: true,
      revealActivePathSignal: 1,
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("does not scroll back to the active file when directories are toggled", () => {
    const file = fileEntry("/workspace/src/User.php", "User.php", "file");

    renderFileTree({
      activePath: file.path,
      file,
      revealActivePath: true,
      revealActivePathSignal: 0,
    });
    scrollIntoView.mockClear();
    renderFileTree({
      activePath: file.path,
      expandedDirectories: new Set(["/workspace/vendor"]),
      file,
      revealActivePath: true,
      revealActivePathSignal: 0,
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps the virtual row window stretched through the scrollable tree area", () => {
    const file = fileEntry("/workspace/src/User.php", "User.php", "file");

    renderFileTree({
      file,
    });

    const window = queryRequired<HTMLElement>(host, ".tree-virtual-window");

    expect(window.style.top).toBe("6px");
    expect(window.style.bottom).toBe("10px");
  });

  it("clips translated virtual rows to the measured tree scroll range", () => {
    const file = fileEntry("/workspace/src/User.php", "User.php", "file");

    renderFileTree({
      file,
    });

    const content = queryRequired<HTMLElement>(host, ".tree-virtual-content");

    expect(content.style.overflow).toBe("hidden");
  });

  it("renders enough virtual rows after the tree reports its real viewport height", () => {
    const files = Array.from({ length: 80 }, (_value, index) =>
      fileEntry(
        `/workspace/src/File${index}.php`,
        `File${index}.php`,
        "file",
      ),
    );

    renderFileTree({
      entriesByDirectory: { "/workspace": files },
    });

    const tree = queryRequired<HTMLElement>(host, ".file-tree");
    Object.defineProperty(tree, "clientHeight", {
      configurable: true,
      value: 960,
    });

    act(() => {
      tree.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(host.querySelectorAll(".tree-row")).toHaveLength(46);
  });

  function renderFileTree({
    activePath = null,
    entriesByDirectory,
    expandedDirectories = new Set<string>(),
    file,
    onOpenFile = vi.fn(),
    onPreviewFile = vi.fn(),
    onToggleDirectory = vi.fn(),
    revealActivePath = false,
    revealActivePathSignal = 0,
  }: {
    activePath?: string | null;
    entriesByDirectory?: Record<string, FileEntry[]>;
    expandedDirectories?: Set<string>;
    file?: FileEntry;
    onOpenFile?: (entry: FileEntry) => void;
    onPreviewFile?: (entry: FileEntry) => void;
    onToggleDirectory?: (path: string) => void;
    revealActivePath?: boolean;
    revealActivePathSignal?: number;
  }) {
    act(() => {
      root.render(
        <FileTree
          activePath={activePath}
          entriesByDirectory={
            entriesByDirectory ?? { "/workspace": file ? [file] : [] }
          }
          expandedDirectories={expandedDirectories}
          loadingDirectories={new Set()}
          onOpenFile={onOpenFile}
          onPreviewFile={onPreviewFile}
          onToggleDirectory={onToggleDirectory}
          revealActivePath={revealActivePath}
          revealActivePathSignal={revealActivePathSignal}
          rootPath="/workspace"
        />,
      );
    });
  }
});

function editorDocument(path: string, name: string): EditorDocument {
  return {
    content: "<?php\n",
    language: "php",
    name,
    path,
    savedContent: "<?php\n",
  };
}

function fileEntry(
  path: string,
  name: string,
  kind: FileEntry["kind"],
): FileEntry {
  return {
    kind,
    name,
    path,
  };
}

function queryRequired<T extends Element>(
  parent: ParentNode,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing test element: ${selector}`);
  }

  return element;
}
