// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  breakpointGroupCollapseStorageKey,
  useBreakpointGroupCollapseState,
  type BreakpointGroupCollapseStorage,
  type UseBreakpointGroupCollapseStateResult,
} from "./useBreakpointGroupCollapseState";

describe("useBreakpointGroupCollapseState", () => {
  let host: HTMLDivElement;
  let root: Root;
  let result: UseBreakpointGroupCollapseStateResult;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({
    activeFilePaths,
    onRender,
    storage,
    workspaceRoot,
  }: {
    readonly activeFilePaths: readonly string[];
    readonly onRender?: (collapsedFilePaths: ReadonlySet<string>) => void;
    readonly storage?: BreakpointGroupCollapseStorage;
    readonly workspaceRoot: string | null;
  }) {
    result = useBreakpointGroupCollapseState(workspaceRoot, activeFilePaths, storage);
    onRender?.(result.collapsedFilePaths);
    return null;
  }

  function render(
    workspaceRoot: string | null,
    activeFilePaths: readonly string[],
    storage?: BreakpointGroupCollapseStorage,
    onRender?: (collapsedFilePaths: ReadonlySet<string>) => void,
  ) {
    act(() =>
      root.render(
        <Harness
          activeFilePaths={activeFilePaths}
          onRender={onRender}
          storage={storage}
          workspaceRoot={workspaceRoot}
        />,
      ),
    );
  }

  it("persists collapsed files across remounts for the same normalized workspace root", () => {
    const filePath = "/workspace/src/a.ts";
    render("/workspace/", [filePath]);
    act(() => result.toggle(filePath));

    expect(window.localStorage.getItem(breakpointGroupCollapseStorageKey("/workspace"))).toBe(
      '["/workspace/src/a.ts"]',
    );

    act(() => root.unmount());
    root = createRoot(host);
    render("/workspace", [filePath]);

    expect(result.collapsedFilePaths).toEqual(new Set([filePath]));
  });

  it("never renders stale collapse state across workspace A to B to A switches", () => {
    const fileA = "/workspace-a/src/a.ts";
    const fileB = "/workspace-b/src/b.ts";
    const renderedSnapshots: ReadonlySet<string>[] = [];
    const capture = (collapsedFilePaths: ReadonlySet<string>) => {
      renderedSnapshots.push(new Set(collapsedFilePaths));
    };
    render("/workspace-a", [fileA], undefined, capture);
    act(() => result.toggle(fileA));

    renderedSnapshots.length = 0;
    render("/workspace-b", [fileB], undefined, capture);
    expect(renderedSnapshots.length).toBeGreaterThan(0);
    expect(renderedSnapshots.every((snapshot) => !snapshot.has(fileA))).toBe(true);
    expect(result.collapsedFilePaths.size).toBe(0);
    act(() => result.toggle(fileB));

    renderedSnapshots.length = 0;
    render("/workspace-a/", [fileA], undefined, capture);
    expect(renderedSnapshots.length).toBeGreaterThan(0);
    expect(renderedSnapshots[0]).toEqual(new Set([fileA]));
    expect(renderedSnapshots.every((snapshot) => !snapshot.has(fileB))).toBe(true);
    expect(result.collapsedFilePaths).toEqual(new Set([fileA]));
    expect(window.localStorage.getItem(breakpointGroupCollapseStorageKey("/workspace-b"))).toBe(
      '["/workspace-b/src/b.ts"]',
    );
  });

  it("keeps null-workspace collapse state in memory without persisting it", () => {
    const filePath = "/loose/file.ts";
    render(null, [filePath]);

    act(() => result.toggle(filePath));
    expect(result.collapsedFilePaths).toEqual(new Set([filePath]));
    expect(window.localStorage.length).toBe(0);

    act(() => result.toggle(filePath));
    expect(result.collapsedFilePaths.size).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });

  it.each([
    ["corrupt JSON", "{", []],
    ["a non-array value", '{"path":"/workspace/a.ts"}', []],
    ["non-string entries", '["/workspace/a.ts",42,null]', ["/workspace/a.ts"]],
    ["empty string entries", '["/workspace/a.ts",""]', ["/workspace/a.ts"]],
  ])("handles %s in persisted state", (_name, raw, expected) => {
    window.localStorage.setItem(breakpointGroupCollapseStorageKey("/workspace"), raw);
    render("/workspace", ["/workspace/a.ts"]);

    expect([...result.collapsedFilePaths]).toEqual(expected);
  });

  it("truncates oversized persisted state on read and write", () => {
    const paths = Array.from(
      { length: 10_001 },
      (_value, index) => `/workspace/${String(index).padStart(5, "0")}.ts`,
    );
    const storageKey = breakpointGroupCollapseStorageKey("/workspace");
    window.localStorage.setItem(storageKey, JSON.stringify(paths));
    render("/workspace", paths);

    expect(result.collapsedFilePaths.size).toBe(10_000);
    const overflowPath = paths[10_000];
    expect(overflowPath).toBeDefined();
    if (!overflowPath) {
      return;
    }
    expect(result.collapsedFilePaths.has(overflowPath)).toBe(false);

    act(() => result.toggle(overflowPath));
    const persisted: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted).toHaveLength(10_000);
  });

  it("drops over-long paths from persistence", () => {
    const overLongPath = `/${"x".repeat(4_096)}`;
    render("/workspace", [overLongPath]);

    act(() => result.toggle(overLongPath));
    expect(result.collapsedFilePaths.has(overLongPath)).toBe(true);
    expect(window.localStorage.getItem(breakpointGroupCollapseStorageKey("/workspace"))).toBeNull();
  });

  it("prunes paths after their breakpoints disappear", () => {
    const fileA = "/workspace/a.ts";
    const fileB = "/workspace/b.ts";
    const storageKey = breakpointGroupCollapseStorageKey("/workspace");
    window.localStorage.setItem(storageKey, JSON.stringify([fileA, fileB]));

    render("/workspace", [fileA]);

    expect(result.collapsedFilePaths).toEqual(new Set([fileA]));
    expect(window.localStorage.getItem(storageKey)).toBe(JSON.stringify([fileA]));
  });

  it("survives storage reads, writes, and removals that throw", () => {
    const storage: BreakpointGroupCollapseStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("blocked");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("blocked");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("blocked");
      }),
    };
    const filePath = "/workspace/a.ts";
    render("/workspace", [filePath], storage);

    act(() => result.toggle(filePath));
    expect(result.collapsedFilePaths).toEqual(new Set([filePath]));
    act(() => result.toggle(filePath));
    expect(result.collapsedFilePaths.size).toBe(0);
  });
});
