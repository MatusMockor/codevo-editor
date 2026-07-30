// @vitest-environment jsdom

import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import { FileTree } from "./FileTree";

const ROOT_PATH = "/workspace";
const SOURCE_PATH = `${ROOT_PATH}/src`;
const DIRECTORY_COUNT = 200;
const FILES_PER_DIRECTORY = 99;
const DESCENDANT_COUNT = DIRECTORY_COUNT + DIRECTORY_COUNT * FILES_PER_DIRECTORY;
const FALLBACK_WINDOW_ROW_LIMIT = 28;
const EXPANDED_TREE_DIRECTORY_READS = DIRECTORY_COUNT + 2;

describe("FileTree large-tree performance contracts", () => {
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

  it("keeps a nested 20,000-entry expanded tree within the virtual DOM window", () => {
    const fixture = largeNestedTreeFixture();

    renderTree({
      entriesByDirectory: fixture.entriesByDirectory,
      expandedDirectories: fixture.expandedDirectories,
    });

    expect(DESCENDANT_COUNT).toBe(20_000);
    expect(visibleRows()).toHaveLength(FALLBACK_WINDOW_ROW_LIMIT);
    expect(directoryReadCount(fixture.directoryReads)).toBe(EXPANDED_TREE_DIRECTORY_READS);
    expect(virtualContent().style.height).toBe("640048px");
  });

  it("bounds traversal and mounted rows across repeated expand and collapse operations", () => {
    const fixture = largeNestedTreeFixture();
    let setSourceExpanded: (expanded: boolean) => void = () => undefined;

    function Harness() {
      const [sourceExpanded, setExpanded] = useState(true);
      setSourceExpanded = setExpanded;
      const expandedDirectories = sourceExpanded ? fixture.expandedDirectories : new Set<string>();
      const handleToggleDirectory = useCallback((path: string) => {
        if (path === SOURCE_PATH) {
          setExpanded((expanded) => !expanded);
        }
      }, []);

      return (
        <FileTree
          activePath={null}
          entriesByDirectory={fixture.entriesByDirectory}
          expandedDirectories={expandedDirectories}
          loadingDirectories={new Set()}
          onOpenFile={vi.fn()}
          onPreviewFile={vi.fn()}
          onToggleDirectory={handleToggleDirectory}
          revealActivePath={false}
          revealActivePathSignal={0}
          rootPath={ROOT_PATH}
        />
      );
    }

    act(() => root.render(<Harness />));
    const readsAfterInitialExpansion = directoryReadCount(fixture.directoryReads);
    expect(readsAfterInitialExpansion).toBe(EXPANDED_TREE_DIRECTORY_READS);
    expect(visibleRows()).toHaveLength(FALLBACK_WINDOW_ROW_LIMIT);
    let readsBeforeToggle = readsAfterInitialExpansion;

    for (let remainingCycles = 12; remainingCycles > 0; remainingCycles -= 1) {
      act(() => setSourceExpanded(false));
      expect(visibleRows()).toHaveLength(1);

      const readsAfterCollapse = directoryReadCount(fixture.directoryReads);
      expect(readsAfterCollapse - readsBeforeToggle).toBe(1);
      readsBeforeToggle = readsAfterCollapse;

      act(() => setSourceExpanded(true));
      expect(visibleRows()).toHaveLength(FALLBACK_WINDOW_ROW_LIMIT);

      const readsAfterExpansion = directoryReadCount(fixture.directoryReads);
      expect(readsAfterExpansion - readsBeforeToggle).toBe(EXPANDED_TREE_DIRECTORY_READS);
      readsBeforeToggle = readsAfterExpansion;
    }
  });

  it("presents an expanded cached empty directory without a loading state", () => {
    const emptyDirectory = directoryEntry(SOURCE_PATH, "src");

    renderTree({
      entriesByDirectory: {
        [ROOT_PATH]: [emptyDirectory],
        [SOURCE_PATH]: [],
      },
      expandedDirectories: new Set([SOURCE_PATH]),
      loadingDirectories: new Set(),
    });

    const sourceRow = visibleRows()[0];
    expect(sourceRow?.getAttribute("aria-expanded")).toBe("true");
    expect(sourceRow?.textContent).toBe("src");
    expect(host.textContent).not.toContain("Loading...");
  });

  function renderTree({
    entriesByDirectory,
    expandedDirectories,
    loadingDirectories = new Set<string>(),
  }: {
    entriesByDirectory: Record<string, FileEntry[]>;
    expandedDirectories: Set<string>;
    loadingDirectories?: Set<string>;
  }) {
    act(() => {
      root.render(
        <FileTree
          activePath={null}
          entriesByDirectory={entriesByDirectory}
          expandedDirectories={expandedDirectories}
          loadingDirectories={loadingDirectories}
          onOpenFile={vi.fn()}
          onPreviewFile={vi.fn()}
          onToggleDirectory={vi.fn()}
          revealActivePath={false}
          revealActivePathSignal={0}
          rootPath={ROOT_PATH}
        />,
      );
    });
  }

  function visibleRows(): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>(".tree-row-virtual")];
  }

  function virtualContent(): HTMLDivElement {
    const content = host.querySelector<HTMLDivElement>(".tree-virtual-content");

    if (!content) {
      throw new Error("Expected FileTree virtual content.");
    }

    return content;
  }
});

function largeNestedTreeFixture(): {
  directoryReads: ReadonlyMap<string, number>;
  entriesByDirectory: Record<string, FileEntry[]>;
  expandedDirectories: Set<string>;
} {
  const directoryReads = new Map<string, number>();
  const entriesByDirectory: Record<string, FileEntry[]> = {
    [ROOT_PATH]: [directoryEntry(SOURCE_PATH, "src")],
  };
  const expandedDirectories = new Set<string>([SOURCE_PATH]);
  const sourceEntries: FileEntry[] = [];

  for (let directoryIndex = 0; directoryIndex < DIRECTORY_COUNT; directoryIndex += 1) {
    const directoryPath = `${SOURCE_PATH}/feature-${directoryIndex}`;
    sourceEntries.push(directoryEntry(directoryPath, `feature-${directoryIndex}`));
    expandedDirectories.add(directoryPath);
    entriesByDirectory[directoryPath] = Array.from(
      { length: FILES_PER_DIRECTORY },
      (_value, fileIndex) =>
        fileEntry(`${directoryPath}/file-${fileIndex}.ts`, `file-${fileIndex}.ts`),
    );
  }

  entriesByDirectory[SOURCE_PATH] = sourceEntries;

  return {
    directoryReads,
    entriesByDirectory: new Proxy(entriesByDirectory, {
      get(target, property, receiver) {
        if (typeof property === "string") {
          directoryReads.set(property, (directoryReads.get(property) ?? 0) + 1);
        }

        return Reflect.get(target, property, receiver) as FileEntry[] | undefined;
      },
    }),
    expandedDirectories,
  };
}

function directoryReadCount(reads: ReadonlyMap<string, number>): number {
  return [...reads.values()].reduce((total, count) => total + count, 0);
}

function directoryEntry(path: string, name: string): FileEntry {
  return { kind: "directory", name, path };
}

function fileEntry(path: string, name: string): FileEntry {
  return { kind: "file", name, path };
}
