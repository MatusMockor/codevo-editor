// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultTextSearchOptions,
  type TextSearchGateway,
  type TextSearchResult,
} from "../domain/workspace";
import {
  useWorkbenchTextSearch,
  type WorkbenchTextSearch,
  type WorkbenchTextSearchDependencies,
} from "./useWorkbenchTextSearch";

describe("useWorkbenchTextSearch exclusions", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current: WorkbenchTextSearch;
  let dependencies: WorkbenchTextSearchDependencies;
  let searchText: ReturnType<typeof vi.fn<TextSearchGateway["searchText"]>>;
  let replaceInPath: ReturnType<typeof vi.fn<TextSearchGateway["replaceInPath"]>>;
  let confirm: ReturnType<typeof vi.fn<(message: string) => boolean>>;
  let setMessage: ReturnType<
    typeof vi.fn<WorkbenchTextSearchDependencies["setMessage"]>
  >;
  let reportError: ReturnType<
    typeof vi.fn<WorkbenchTextSearchDependencies["reportError"]>
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    searchText = vi.fn(async (workspaceRoot, query) =>
      query === "next"
        ? [match(workspaceRoot, "next.php")]
        : [
            match(workspaceRoot, "a.php"),
            match(workspaceRoot, "a.php", 2),
            match(workspaceRoot, "b.php"),
            match(workspaceRoot, "c.php"),
          ],
    );
    replaceInPath = vi.fn(async (_root, _query, _replacement, _options, path) => ({
      files: path
        ? [{ path, relativePath: path.split("/").slice(-1)[0], replacements: 1 }]
        : [],
      totalReplacements: path ? 1 : 0,
    }));
    confirm = vi.fn<(message: string) => boolean>(() => true);
    setMessage = vi.fn<WorkbenchTextSearchDependencies["setMessage"]>();
    reportError = vi.fn<WorkbenchTextSearchDependencies["reportError"]>();
    dependencies = {
      workspaceRoot: "/workspace-a",
      activeDocumentRef: { current: null },
      currentWorkspaceRootRef: { current: "/workspace-a" },
      documentsRef: { current: {} },
      openFileRef: { current: vi.fn(async () => true) },
      prompter: { confirm, prompt: vi.fn(() => null) },
      textSearch: { searchText, replaceInPath },
      workspaceFiles: {} as WorkbenchTextSearchDependencies["workspaceFiles"],
      reportError,
      setDocuments: vi.fn(),
      setEditorRevealTarget: vi.fn(),
      setMessage,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("dismisses by path and resets on a new search and workspace switch without leaking", async () => {
    await renderAndSearch();

    act(() => current.dismissTextSearchFile("/workspace-a/a.php"));
    expect([...current.dismissedTextSearchPaths]).toEqual(["/workspace-a/a.php"]);

    act(() => current.setTextSearchQuery("next"));
    expect(current.dismissedTextSearchPaths.size).toBe(0);
    await runSearchTimer();

    act(() => current.dismissTextSearchFile("/workspace-a/next.php"));
    expect(current.dismissedTextSearchPaths.size).toBe(1);

    dependencies.currentWorkspaceRootRef.current = "/workspace-b";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-b" };
    render();
    expect(current.dismissedTextSearchPaths.size).toBe(0);
    await runSearchTimer();
    expect(current.textSearchResults[0]?.path).toBe("/workspace-b/next.php");

    dependencies.currentWorkspaceRootRef.current = "/workspace-a";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-a" };
    render();
    expect(current.dismissedTextSearchPaths.size).toBe(0);
  });

  it("keeps the whole-scope gateway call unchanged when nothing is excluded", async () => {
    await renderAndSearch();
    act(() => current.setTextReplacement("thread"));

    await act(async () => current.replaceAllInPath());

    expect(replaceInPath).toHaveBeenCalledTimes(1);
    expect(replaceInPath).toHaveBeenCalledWith(
      "/workspace-a",
      "needle",
      "thread",
      defaultTextSearchOptions(),
      undefined,
    );
  });

  it("confirms included counts and sequentially replaces only included files with the same options", async () => {
    await renderAndSearch();
    const options = {
      caseSensitive: true,
      wholeWord: true,
      isRegex: true,
      preserveCase: true,
      fileMask: "*.php",
    };
    act(() => {
      current.setTextSearchOptions(options);
      current.setTextReplacement("thread");
    });
    await runSearchTimer();
    act(() => current.dismissTextSearchFile("/workspace-a/a.php"));

    await act(async () => current.replaceAllInPath());

    expect(confirm).toHaveBeenCalledWith(
      "Replace 2 occurrences in 2 files? This rewrites files on disk and is restorable from Local History.",
    );
    expect(replaceInPath.mock.calls.map((call) => call[4])).toEqual([
      "/workspace-a/b.php",
      "/workspace-a/c.php",
    ]);
    expect(replaceInPath.mock.calls.every((call) => call[3] === options)).toBe(true);
  });

  it("warns that capped replacement with exclusions only changes listed files", async () => {
    searchText.mockResolvedValueOnce([
      match("/workspace-a", "dismissed.php"),
      match("/workspace-a", "dismissed.php", 2),
      ...Array.from({ length: 98 }, (_, index) =>
        match("/workspace-a", "included.php", index + 1),
      ),
    ]);
    await renderAndSearch();
    act(() =>
      current.dismissTextSearchFile("/workspace-a/dismissed.php"),
    );

    await act(async () => current.replaceAllInPath());

    expect(confirm).toHaveBeenCalledWith(
      "Replace 98 occurrences in 1 listed file? Only the files currently listed will be replaced. Matches beyond the displayed results will not be modified; refine your search to include them. This rewrites files on disk and is restorable from Local History.",
    );
    expect(replaceInPath.mock.calls.map((call) => call[4])).toEqual([
      "/workspace-a/included.php",
    ]);
  });

  it("reports the aggregate success message for sequential replacement", async () => {
    await renderAndSearch();
    act(() => current.dismissTextSearchFile("/workspace-a/a.php"));

    await act(async () => current.replaceAllInPath());

    expect(setMessage).toHaveBeenCalledWith(
      "Replaced 2 occurrences in 2 files",
    );
  });

  it("aggregates per-file successes, conflicts, and thrown failures honestly", async () => {
    searchText.mockResolvedValueOnce([
      match("/workspace-a", "a.php"),
      match("/workspace-a", "b.php"),
      match("/workspace-a", "c.php"),
      match("/workspace-a", "dismissed.php"),
    ]);
    replaceInPath.mockImplementation(async (_root, _query, _replacement, _options, path) => {
      if (path?.endsWith("b.php")) {
        return {
          status: "conflict",
          files: [],
          totalReplacements: 0,
          conflicts: [{ path, relativePath: "b.php", message: "changed concurrently" }],
          message: "one conflict",
        };
      }

      if (path?.endsWith("c.php")) {
        throw new Error("permission denied");
      }

      return {
        files: [{ path: path!, relativePath: "a.php", replacements: 2 }],
        totalReplacements: 2,
      };
    });
    await renderAndSearch();
    act(() =>
      current.dismissTextSearchFile("/workspace-a/dismissed.php"),
    );
    await act(async () => current.replaceAllInPath());

    expect(replaceInPath.mock.calls.map((call) => call[4])).toEqual([
      "/workspace-a/a.php",
      "/workspace-a/b.php",
      "/workspace-a/c.php",
    ]);
    expect(setMessage).toHaveBeenCalledWith(
      "replacement completed partially: 1 conflict(s), 1 error(s)",
    );
    expect(reportError).not.toHaveBeenCalled();
  });

  async function renderAndSearch() {
    render();
    act(() => {
      current.setTextSearchOpen(true);
      current.setTextSearchQuery("needle");
    });
    await runSearchTimer();
  }

  function render() {
    act(() => {
      root.render(<Harness dependencies={dependencies} />);
    });
  }

  async function runSearchTimer() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(181);
    });
  }

  function Harness({ dependencies }: { dependencies: WorkbenchTextSearchDependencies }) {
    current = useWorkbenchTextSearch(dependencies);
    return null;
  }
});

function match(root: string, relativePath: string, lineNumber = 1): TextSearchResult {
  return {
    path: `${root}/${relativePath}`,
    relativePath,
    lineNumber,
    column: 1,
    lineText: "needle",
    matchStart: 0,
    matchEnd: 6,
  };
}
