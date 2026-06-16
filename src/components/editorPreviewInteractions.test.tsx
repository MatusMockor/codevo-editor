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

  function renderFileTree({
    file,
    onOpenFile = vi.fn(),
    onPreviewFile = vi.fn(),
    onToggleDirectory = vi.fn(),
  }: {
    file: FileEntry;
    onOpenFile?: (entry: FileEntry) => void;
    onPreviewFile?: (entry: FileEntry) => void;
    onToggleDirectory?: (path: string) => void;
  }) {
    act(() => {
      root.render(
        <FileTree
          activePath={null}
          entriesByDirectory={{ "/workspace": [file] }}
          expandedDirectories={new Set()}
          expandedPhpFilePaths={new Set()}
          loadingDirectories={new Set()}
          loadingPhpFileOutlinePaths={new Set()}
          onOpenFile={onOpenFile}
          onOpenPhpFileOutlineNode={vi.fn()}
          onPreviewFile={onPreviewFile}
          onToggleDirectory={onToggleDirectory}
          onTogglePhpFileOutline={vi.fn()}
          onTogglePhpFileOutlineNode={vi.fn()}
          phpFileOutlineExpandedNodeIds={new Set()}
          phpFileOutlinesByPath={{}}
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
