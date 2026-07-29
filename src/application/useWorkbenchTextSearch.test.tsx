// @vitest-environment jsdom

import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultTextSearchOptions,
  type EditorDocument,
  type TextSearchGateway,
  type TextSearchResult,
} from "../domain/workspace";
import { searchQueryHistorySession } from "../domain/searchQueryHistory";
import {
  DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS,
  type DirtyTextSearchComputationGateway,
} from "./dirtyTextSearchComputation";
import type {
  DirtyTextSearchComputationRequest,
  DirtyTextSearchComputationResponse,
} from "./dirtyTextSearchComputation";
import { computeDirtyTextSearch } from "./dirtyTextSearchMatcher";
import {
  collectDirtyTextSearchDocuments,
  useWorkbenchTextSearch,
  type WorkbenchTextSearch,
  type WorkbenchTextSearchDependencies,
} from "./useWorkbenchTextSearch";

describe("useWorkbenchTextSearch exclusions", () => {
  const neverSettles = new Promise<never>(() => undefined);
  let host: HTMLDivElement;
  let root: Root;
  let current: WorkbenchTextSearch;
  let dependencies: WorkbenchTextSearchDependencies;
  let searchText: ReturnType<typeof vi.fn<TextSearchGateway["searchText"]>>;
  let replaceInPath: ReturnType<typeof vi.fn<TextSearchGateway["replaceInPath"]>>;
  let confirm: ReturnType<typeof vi.fn<(message: string) => boolean>>;
  let setMessage: ReturnType<typeof vi.fn<WorkbenchTextSearchDependencies["setMessage"]>>;
  let reportError: ReturnType<typeof vi.fn<WorkbenchTextSearchDependencies["reportError"]>>;
  let dirtyTextSearch: DirtyTextSearchComputationGateway;

  beforeEach(() => {
    searchQueryHistorySession.clear();
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
      files: path ? [{ path, relativePath: path.split("/").slice(-1)[0], replacements: 1 }] : [],
      totalReplacements: path ? 1 : 0,
    }));
    confirm = vi.fn<(message: string) => boolean>(() => true);
    setMessage = vi.fn<WorkbenchTextSearchDependencies["setMessage"]>();
    reportError = vi.fn<WorkbenchTextSearchDependencies["reportError"]>();
    dirtyTextSearch = {
      compute: vi.fn(async (request) =>
        computeDirtyTextSearch(request, {
          hasTimeRemaining: () => true,
          utf8ByteLength: (value) => new TextEncoder().encode(value).byteLength,
        }),
      ),
    };
    dependencies = {
      workspaceRoot: "/workspace-a",
      workspaceOwnerKey: "workspace-owner-a",
      activeDocumentRef: { current: null },
      currentWorkspaceRootRef: { current: "/workspace-a" },
      documentsRef: { current: {} },
      openFileRef: { current: vi.fn(async () => true) },
      prompter: { confirm, prompt: vi.fn(() => null) },
      dirtyTextSearch,
      textSearch: { searchText, replaceInPath },
      workspaceFiles: {} as WorkbenchTextSearchDependencies["workspaceFiles"],
      reportError,
      reportChangedDocuments: vi.fn(),
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

  it("records submitted queries in the active workspace history without cross-root leakage", async () => {
    await renderAndSearch();
    expect(searchQueryHistorySession.active()).toEqual(["needle"]);

    dependencies.currentWorkspaceRootRef.current = "/workspace-b";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-b" };
    render();
    expect(searchQueryHistorySession.active()).toEqual([]);

    act(() => current.setTextSearchQuery("other"));
    await runSearchTimer();
    expect(searchQueryHistorySession.active()).toEqual(["other"]);

    dependencies.currentWorkspaceRootRef.current = "/workspace-a";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-a" };
    render();
    expect(searchQueryHistorySession.active()).toEqual(["needle"]);
  });

  it("treats A-B-A as distinct generations and ignores both earlier responses", async () => {
    const searchA1 = deferred<TextSearchResult[]>();
    const searchB = deferred<TextSearchResult[]>();
    const searchA2 = deferred<TextSearchResult[]>();
    searchText
      .mockImplementationOnce(() => searchA1.promise)
      .mockImplementationOnce(() => searchB.promise)
      .mockImplementationOnce(() => searchA2.promise);

    render();
    act(() => {
      current.setTextSearchOpen(true);
      current.setTextSearchQuery("needle");
    });
    await runSearchTimer();

    dependencies.currentWorkspaceRootRef.current = "/workspace-b";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-b" };
    render();
    expect(current.textSearchResults).toEqual([]);
    expect(current.textSearchLoading).toBe(true);
    await runSearchTimer();

    dependencies.currentWorkspaceRootRef.current = "/workspace-a";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-a" };
    render();
    expect(current.textSearchResults).toEqual([]);
    await runSearchTimer();

    await act(async () => {
      searchA1.resolve([match("/workspace-a", "stale-a.php")]);
      await Promise.resolve();
    });
    expect(current.textSearchResults).toEqual([]);

    await act(async () => {
      searchA2.resolve([match("/workspace-a", "fresh-a.php")]);
      await Promise.resolve();
    });
    expect(current.textSearchResults.map((result) => result.relativePath)).toEqual(["fresh-a.php"]);

    await act(async () => {
      searchB.resolve([match("/workspace-b", "stale-b.php")]);
      await Promise.resolve();
    });
    expect(current.textSearchResults.map((result) => result.relativePath)).toEqual(["fresh-a.php"]);
  });

  it("rejects a stale row click after the workspace changes", async () => {
    await renderAndSearch();
    const staleResult = current.textSearchResults[0];
    const staleOpen = current.openTextSearchResult;

    dependencies.currentWorkspaceRootRef.current = "/workspace-b";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-b" };
    render();

    await act(async () => staleOpen(staleResult));

    expect(dependencies.openFileRef.current).not.toHaveBeenCalled();
    expect(dependencies.setEditorRevealTarget).not.toHaveBeenCalled();
  });

  it("disables replacement synchronously when criteria no longer own the displayed results", async () => {
    await renderAndSearch();
    const staleReplace = current.replaceAllInPath;
    let immediateReplace!: Promise<void>;

    act(() => {
      current.setTextSearchOptions((options) => ({
        ...options,
        caseSensitive: true,
      }));
      immediateReplace = staleReplace();
    });
    expect(current.textSearchResults).toEqual([]);
    expect(current.textSearchLoading).toBe(true);

    await act(async () => {
      await immediateReplace;
      await current.replaceAllInPath();
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(replaceInPath).not.toHaveBeenCalled();
  });

  it("admits only one replace flight for same-tick duplicate invocations", async () => {
    const replacement = deferred<Awaited<ReturnType<TextSearchGateway["replaceInPath"]>>>();
    replaceInPath.mockImplementationOnce(() => replacement.promise);
    await renderAndSearch();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = current.replaceAllInPath();
      second = current.replaceAllInPath();
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(replaceInPath).toHaveBeenCalledTimes(1);
    expect(current.textReplaceBusy).toBe(true);

    await act(async () => {
      replacement.resolve({ files: [], totalReplacements: 0 });
      await Promise.all([first, second]);
    });

    expect(current.textReplaceBusy).toBe(false);
  });

  it("keeps a workspace-B replace busy when a revoked workspace-A flight settles", async () => {
    const replacementA = deferred<Awaited<ReturnType<TextSearchGateway["replaceInPath"]>>>();
    const replacementB = deferred<Awaited<ReturnType<TextSearchGateway["replaceInPath"]>>>();
    replaceInPath
      .mockImplementationOnce(() => replacementA.promise)
      .mockImplementationOnce(() => replacementB.promise);
    await renderAndSearch();

    let flightA!: Promise<void>;
    act(() => {
      flightA = current.replaceAllInPath();
    });
    expect(current.textReplaceBusy).toBe(true);

    dependencies.currentWorkspaceRootRef.current = "/workspace-b";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-b" };
    render();
    expect(current.textReplaceBusy).toBe(false);
    await runSearchTimer();

    let flightB!: Promise<void>;
    act(() => {
      flightB = current.replaceAllInPath();
    });
    expect(replaceInPath).toHaveBeenCalledTimes(2);
    expect(current.textReplaceBusy).toBe(true);

    await act(async () => {
      replacementA.resolve({ files: [], totalReplacements: 0 });
      await flightA;
    });
    expect(current.textReplaceBusy).toBe(true);

    await act(async () => {
      replacementB.resolve({ files: [], totalReplacements: 0 });
      await flightB;
    });
    expect(current.textReplaceBusy).toBe(false);
  });

  it("keeps a late response from replacing the latest query snapshot", async () => {
    const staleSearch = deferred<TextSearchResult[]>();
    const latestSearch = deferred<TextSearchResult[]>();
    searchText
      .mockImplementationOnce(() => staleSearch.promise)
      .mockImplementationOnce(() => latestSearch.promise);

    render();
    act(() => {
      current.setTextSearchOpen(true);
      current.setTextSearchQuery("needle");
    });
    await runSearchTimer();
    act(() => current.setTextSearchQuery("next"));
    expect(current.textSearchResults).toEqual([]);
    await runSearchTimer();

    await act(async () => {
      latestSearch.resolve([match("/workspace-a", "next.php")]);
      await Promise.resolve();
    });
    expect(current.textSearchResults.map((result) => result.relativePath)).toEqual(["next.php"]);

    await act(async () => {
      staleSearch.resolve([match("/workspace-a", "stale.php")]);
      await Promise.resolve();
    });
    expect(current.textSearchResults.map((result) => result.relativePath)).toEqual(["next.php"]);
  });

  it("uses authoritative truncation metadata without a sentinel request", async () => {
    const searchTextWithMetadata = vi.fn(
      async (
        root: string,
        _query: string,
        _limit: number,
        _options: ReturnType<typeof defaultTextSearchOptions> | undefined,
        requestGeneration = "",
      ) => ({
        requestGeneration,
        results: [match(root, "only-visible.ts")],
        truncated: true,
      }),
    );
    dependencies = {
      ...dependencies,
      textSearch: { searchText, searchTextWithMetadata, replaceInPath },
    };

    await renderAndSearch();

    expect(searchText).not.toHaveBeenCalled();
    expect(searchTextWithMetadata).toHaveBeenCalledWith(
      "/workspace-a",
      "needle",
      100,
      defaultTextSearchOptions(),
      expect.any(String),
    );
    expect(current.textSearchResults).toHaveLength(1);
    expect(current.textSearchResultCountLowerBound).toBe(2);
    expect(current.textSearchHasMoreResults).toBe(true);
    expect(current.textSearchResultsTruncated).toBe(true);
  });

  it("rejects a metadata response from a different request generation", async () => {
    const searchTextWithMetadata = vi.fn(async (root: string) => ({
      requestGeneration: "foreign-generation",
      results: [match(root, "stale.ts")],
      truncated: false,
    }));
    dependencies = {
      ...dependencies,
      textSearch: { searchText, searchTextWithMetadata, replaceInPath },
    };

    await renderAndSearch();

    expect(current.textSearchResults).toEqual([]);
    expect(current.textSearchLoading).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      "Text Search",
      expect.objectContaining({ message: "Text search returned a mismatched request generation." }),
    );
  });

  it("replaces on-disk rows for dirty documents with authoritative unsaved matches", async () => {
    searchText.mockResolvedValueOnce([
      match("/workspace-a", "dirty.ts"),
      match("/workspace-a", "clean.ts"),
    ]);
    dependencies.documentsRef.current = {
      "/workspace-a/dirty.ts": dirtyDocument(
        "/workspace-a/dirty.ts",
        "const removed = true;",
        "needle on disk",
      ),
      "/workspace-a/added.ts": dirtyDocument(
        "/workspace-a/added.ts",
        "needle one\nneedle two",
        "const saved = true;",
      ),
    };

    await renderAndSearch();

    expect(
      current.textSearchResults.map(({ relativePath, lineNumber }) => [relativePath, lineNumber]),
    ).toEqual([
      ["clean.ts", 1],
      ["added.ts", 1],
      ["added.ts", 2],
    ]);
  });

  it("projects long Unicode dirty-buffer previews with bounded nonnegative offsets", async () => {
    dependencies.documentsRef.current = {
      "/workspace-a/unicode.ts": dirtyDocument(
        "/workspace-a/unicode.ts",
        `${"😀".repeat(4_500)}needle`,
        "const saved = true;",
      ),
    };

    await renderAndSearch();

    const result = current.textSearchResults.find(
      (candidate) => candidate.relativePath === "unicode.ts",
    );
    expect(result).toBeDefined();
    expect(Array.from(result?.lineText ?? "")).toHaveLength(4_096);
    expect(result?.matchStart).toBeGreaterThanOrEqual(0);
    expect(result?.matchEnd).toBeLessThanOrEqual(4_096);
    expect(result?.previewTruncated).toBe(true);
    expect(result?.matchTruncated).toBe(false);
  });

  it("marks a dirty-buffer match clipped by the bounded preview", async () => {
    const longMatch = "😀".repeat(5_000);
    dependencies.documentsRef.current = {
      "/workspace-a/long-match.ts": dirtyDocument(
        "/workspace-a/long-match.ts",
        longMatch,
        "const saved = true;",
      ),
    };
    render();
    act(() => {
      current.setTextSearchOpen(true);
      current.setTextSearchQuery(longMatch);
    });
    await runSearchTimer();

    const result = current.textSearchResults.find(
      (candidate) => candidate.relativePath === "long-match.ts",
    );
    expect(Array.from(result?.lineText ?? "")).toHaveLength(4_096);
    expect(result?.matchStart).toBe(0);
    expect(result?.matchEnd).toBe(4_096);
    expect(result?.previewTruncated).toBe(true);
    expect(result?.matchTruncated).toBe(true);
  });

  it("does not overclaim a backend lower bound after a dirty overlay removes a disk row", async () => {
    const searchTextWithMetadata = vi.fn(
      async (
        _root: string,
        _query: string,
        _limit: number,
        _options: ReturnType<typeof defaultTextSearchOptions> | undefined,
        requestGeneration = "",
      ) => ({
        requestGeneration,
        results: [match("/workspace-a", "dirty.ts"), match("/workspace-a", "clean.ts")],
        truncated: true,
      }),
    );
    dependencies = {
      ...dependencies,
      documentsRef: {
        current: {
          "/workspace-a/dirty.ts": dirtyDocument(
            "/workspace-a/dirty.ts",
            "const removed = true;",
            "needle on disk",
          ),
        },
      },
      textSearch: { searchText, searchTextWithMetadata, replaceInPath },
    };

    await renderAndSearch();

    expect(current.textSearchResults.map((result) => result.relativePath)).toEqual(["clean.ts"]);
    expect(current.textSearchResultsTruncated).toBe(true);
    expect(current.textSearchResultCountLowerBound).toBe(1);
  });

  it("never leaks a stale disk row when an oversized dirty document is skipped", async () => {
    searchText.mockResolvedValueOnce([match("/workspace-a", "oversized.ts")]);
    dependencies.documentsRef.current = {
      "/workspace-a/oversized.ts": dirtyDocument(
        "/workspace-a/oversized.ts",
        `needle${"x".repeat(4 * 1024 * 1024)}`,
        "needle on disk",
      ),
    };

    await renderAndSearch();

    expect(current.textSearchResults).toEqual([]);
    expect(current.textSearchResultsTruncated).toBe(true);
    expect(current.textSearchResultCountLowerBound).toBe(0);
    const dirtyRequest = vi.mocked(dirtyTextSearch.compute).mock.calls[0][0];
    expect(dirtyRequest.documents).toEqual([]);
    expect(dirtyRequest.preflightLimitations).toContain("document-too-large");
  });

  it("fails closed for non-ASCII dirty whole-word matching instead of claiming Rust parity", async () => {
    searchText.mockResolvedValueOnce([match("/workspace-a", "unicode.ts")]);
    dependencies.documentsRef.current = {
      "/workspace-a/unicode.ts": dirtyDocument(
        "/workspace-a/unicode.ts",
        "élan 变量",
        "élan on disk",
      ),
    };
    render();
    act(() => {
      current.setTextSearchOpen(true);
      current.setTextSearchOptions({ ...defaultTextSearchOptions(), wholeWord: true });
      current.setTextSearchQuery("élan");
    });
    await runSearchTimer();

    expect(current.textSearchResults).toEqual([]);
    expect(current.textSearchResultsTruncated).toBe(true);
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining("omitted"));
  });

  it("aborts and fences an A-B-A dirty snapshot while backend search is already complete", async () => {
    const flights: Array<{
      request: DirtyTextSearchComputationRequest;
      signal: AbortSignal;
      deferred: ReturnType<typeof deferred<DirtyTextSearchComputationResponse>>;
    }> = [];
    dependencies = {
      ...dependencies,
      dirtyTextSearch: {
        compute: vi.fn((request, signal) => {
          const pending = deferred<DirtyTextSearchComputationResponse>();
          flights.push({ request, signal, deferred: pending });
          return pending.promise;
        }),
      },
      documentsRef: {
        current: {
          "/workspace-a/live.ts": dirtyDocument("/workspace-a/live.ts", "needle-a", "saved"),
        },
      },
    };
    render();
    act(() => {
      current.setTextSearchOpen(true);
      current.setTextSearchQuery("needle");
    });
    await runSearchTimer();
    const firstA = flights[0];

    dependencies.documentsRef.current = {
      "/workspace-a/live.ts": dirtyDocument("/workspace-a/live.ts", "needle-b", "saved"),
    };
    render();
    await runSearchTimer();
    expect(firstA.signal.aborted).toBe(true);

    dependencies.documentsRef.current = {
      "/workspace-a/live.ts": dirtyDocument("/workspace-a/live.ts", "needle-a", "saved"),
    };
    render();
    await runSearchTimer();
    const secondA = flights[2];
    expect(secondA.request.documents[0].documentRevision).toBeGreaterThan(
      firstA.request.documents[0].documentRevision,
    );

    await act(async () => {
      secondA.deferred.resolve({
        authority: secondA.request.authority,
        dirtyPaths: secondA.request.dirtyPaths,
        limitations: [],
        results: [match("/workspace-a", "live.ts")],
        truncated: false,
      });
      await Promise.resolve();
    });
    expect(current.textSearchResults.map((result) => result.relativePath)).toContain("live.ts");

    await act(async () => {
      firstA.deferred.resolve({
        authority: firstA.request.authority,
        dirtyPaths: firstA.request.dirtyPaths,
        limitations: [],
        results: [match("/workspace-a", "stale.ts")],
        truncated: false,
      });
      await Promise.resolve();
    });
    expect(current.textSearchResults.map((result) => result.relativePath)).not.toContain(
      "stale.ts",
    );
  });

  it("does not advance committed authority for an abandoned suspended dirty render", async () => {
    const requests: DirtyTextSearchComputationRequest[] = [];
    dependencies = {
      ...dependencies,
      dirtyTextSearch: {
        compute: vi.fn(async (request) => {
          requests.push(request);
          return computeDirtyTextSearch(request, {
            hasTimeRemaining: () => true,
            utf8ByteLength: (value) => new TextEncoder().encode(value).byteLength,
          });
        }),
      },
      documentsRef: {
        current: {
          "/workspace-a/live.ts": dirtyDocument("/workspace-a/live.ts", "needle-a", "needle saved"),
        },
      },
    };
    await renderAndSearch();
    expect(requests[0].authority.searchGeneration).toBe(1);

    dependencies.documentsRef.current = {
      "/workspace-a/live.ts": dirtyDocument("/workspace-a/live.ts", "needle-b", "needle saved"),
    };
    act(() => {
      root.render(
        <Suspense fallback={null}>
          <Harness dependencies={dependencies} suspend={neverSettles} />
        </Suspense>,
      );
    });

    dependencies.documentsRef.current = {
      "/workspace-a/live.ts": dirtyDocument("/workspace-a/live.ts", "needle-a", "needle saved"),
    };
    render();
    await runSearchTimer();

    expect(requests).toHaveLength(2);
    expect(requests[1].authority.searchGeneration).toBe(2);
  });

  it("invalidates the completed owner and refreshes when a dirty buffer changes", async () => {
    dependencies.documentsRef.current = {
      "/workspace-a/live.ts": dirtyDocument(
        "/workspace-a/live.ts",
        "needle first",
        "const saved = true;",
      ),
    };
    await renderAndSearch();
    expect(current.textSearchResults.some((result) => result.relativePath === "live.ts")).toBe(
      true,
    );

    dependencies.documentsRef.current = {
      "/workspace-a/live.ts": dirtyDocument(
        "/workspace-a/live.ts",
        "const removed = true;",
        "const saved = true;",
      ),
    };
    render();

    expect(current.textSearchResults).toEqual([]);
    expect(current.textSearchLoading).toBe(true);
    await runSearchTimer();
    expect(current.textSearchResults.some((result) => result.relativePath === "live.ts")).toBe(
      false,
    );
  });

  it("blocks disk replacement with an explicit reason while an eligible file is dirty", async () => {
    dependencies.documentsRef.current = {
      "/workspace-a/dirty.ts": dirtyDocument(
        "/workspace-a/dirty.ts",
        "needle in memory",
        "needle on disk",
      ),
    };
    await renderAndSearch();

    await act(async () => current.replaceAllInPath());

    expect(confirm).not.toHaveBeenCalled();
    expect(replaceInPath).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(
      "Replace blocked: save or revert unsaved changes in 1 eligible file before replacing on disk.",
    );
  });

  it("keeps search open after navigating to a result", async () => {
    await renderAndSearch();

    await act(async () => current.openTextSearchResult(current.textSearchResults[1]));

    expect(current.textSearchOpen).toBe(true);
    expect(current.textSearchResults).toHaveLength(4);
  });

  it("pages with a sentinel result and reports truthful lower bounds", async () => {
    searchText.mockImplementation(async (root, _query, limit) =>
      Array.from({ length: limit }, (_, index) => match(root, `${index}.ts`, index + 1)),
    );
    await renderAndSearch();

    expect(searchText).toHaveBeenLastCalledWith(
      "/workspace-a",
      "needle",
      101,
      defaultTextSearchOptions(),
    );
    expect(current.textSearchResults).toHaveLength(100);
    expect(current.textSearchResultCountLowerBound).toBe(101);
    expect(current.textSearchHasMoreResults).toBe(true);

    act(() => current.loadMoreTextSearchResults());
    await runSearchTimer();

    expect(searchText).toHaveBeenLastCalledWith(
      "/workspace-a",
      "needle",
      201,
      defaultTextSearchOptions(),
    );
    expect(current.textSearchResults).toHaveLength(200);
    expect(current.textSearchResultCountLowerBound).toBe(201);
  });

  it("preserves dismissed file groups while loading another page", async () => {
    searchText.mockImplementation(async (root, _query, limit) =>
      Array.from({ length: limit }, (_, index) => match(root, `${index}.ts`, index + 1)),
    );
    await renderAndSearch();
    act(() => current.dismissTextSearchFile("/workspace-a/0.ts"));

    act(() => current.loadMoreTextSearchResults());
    await runSearchTimer();

    expect([...current.dismissedTextSearchPaths]).toEqual(["/workspace-a/0.ts"]);
  });

  it("marks the unchanged backend ceiling as truncated without offering another page", async () => {
    searchText.mockImplementation(async (root, _query, limit) =>
      Array.from({ length: limit }, (_, index) => match(root, `${index}.ts`, index + 1)),
    );
    await renderAndSearch();

    for (let page = 0; page < 4; page += 1) {
      act(() => current.loadMoreTextSearchResults());
      await runSearchTimer();
    }

    expect(current.textSearchResults).toHaveLength(500);
    expect(current.textSearchResultCountLowerBound).toBe(500);
    expect(current.textSearchResultsTruncated).toBe(true);
    expect(current.textSearchHasMoreResults).toBe(false);
  });

  it("restores only the active root's dismissed files and recovers visible counts", async () => {
    await renderAndSearch();
    act(() => current.dismissTextSearchFile("/workspace-a/a.php"));
    const restoreWorkspaceA = current.restoreDismissedTextSearchFiles;

    expect(
      current.textSearchResults.filter(
        (result) => !current.dismissedTextSearchPaths.has(result.path),
      ),
    ).toHaveLength(2);

    dependencies.currentWorkspaceRootRef.current = "/workspace-b";
    dependencies = { ...dependencies, workspaceRoot: "/workspace-b" };
    render();
    await runSearchTimer();
    act(() => current.dismissTextSearchFile("/workspace-b/a.php"));

    act(() => restoreWorkspaceA());
    expect([...current.dismissedTextSearchPaths]).toEqual(["/workspace-b/a.php"]);

    act(() => current.restoreDismissedTextSearchFiles());
    expect(current.dismissedTextSearchPaths.size).toBe(0);
    expect(
      current.textSearchResults.filter(
        (result) => !current.dismissedTextSearchPaths.has(result.path),
      ),
    ).toHaveLength(4);

    confirm.mockReturnValueOnce(false);
    await act(async () => current.replaceAllInPath());
    expect(confirm).toHaveBeenCalledWith(
      "Replace 4 occurrences in 3 files? This rewrites files on disk and is restorable from Local History.",
    );
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
    expect(replaceInPath.mock.calls.every((call) => call[3] !== options)).toBe(true);
    expect(replaceInPath.mock.calls.map((call) => call[3])).toEqual([options, options]);
  });

  it("warns that capped replacement with exclusions only changes listed files", async () => {
    searchText.mockResolvedValueOnce([
      match("/workspace-a", "dismissed.php"),
      match("/workspace-a", "dismissed.php", 2),
      ...Array.from({ length: 99 }, (_, index) => match("/workspace-a", "included.php", index + 1)),
    ]);
    await renderAndSearch();
    act(() => current.dismissTextSearchFile("/workspace-a/dismissed.php"));

    await act(async () => current.replaceAllInPath());

    expect(confirm).toHaveBeenCalledWith(
      "Replace 98 occurrences in 1 listed file? Only the files currently listed will be replaced. Matches beyond the displayed results will not be modified; refine your search to include them. This rewrites files on disk and is restorable from Local History.",
    );
    expect(replaceInPath.mock.calls.map((call) => call[4])).toEqual(["/workspace-a/included.php"]);
  });

  it("reports the aggregate success message for sequential replacement", async () => {
    await renderAndSearch();
    act(() => current.dismissTextSearchFile("/workspace-a/a.php"));

    await act(async () => current.replaceAllInPath());

    expect(setMessage).toHaveBeenCalledWith("Replaced 2 occurrences in 2 files");
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
    act(() => current.dismissTextSearchFile("/workspace-a/dismissed.php"));
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

  it("does not enumerate open documents while Text Search is closed", () => {
    dependencies.documentsRef.current = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("closed search enumerated documents");
        },
      },
    );

    expect(() => render()).not.toThrow();
    expect(searchText).not.toHaveBeenCalled();
    expect(dirtyTextSearch.compute).not.toHaveBeenCalled();
  });

  it("fails closed before backend or worker work when dirty paths exceed the hard cap", async () => {
    dependencies.documentsRef.current = Object.fromEntries(
      Array.from({ length: DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS + 1 }, (_, index) => {
        const path = `/workspace-a/file-${index}.ts`;
        return [path, dirtyDocument(path, "dirty", "saved")];
      }),
    );

    render();
    act(() => {
      current.setTextSearchOpen(true);
      current.setTextSearchQuery("needle");
    });
    await runSearchTimer();

    expect(searchText).not.toHaveBeenCalled();
    expect(dirtyTextSearch.compute).not.toHaveBeenCalled();
    expect(current.textSearchResults).toEqual([]);
    expect(current.textSearchResultsTruncated).toBe(true);
    expect(setMessage).toHaveBeenCalledWith(
      "Dirty-buffer search exceeded the open-file safety limit; results are omitted.",
    );
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
      root.render(
        <Suspense fallback={null}>
          <Harness dependencies={dependencies} />
        </Suspense>,
      );
    });
  }

  async function runSearchTimer() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(181);
    });
  }

  function Harness({
    dependencies,
    suspend,
  }: {
    dependencies: WorkbenchTextSearchDependencies;
    suspend?: Promise<never>;
  }) {
    current = useWorkbenchTextSearch(dependencies);
    if (suspend) {
      throw suspend;
    }
    return null;
  }
});

describe("collectDirtyTextSearchDocuments", () => {
  it("caps total enumeration before sorting and reports overflow", () => {
    const documents = Object.fromEntries(
      Array.from({ length: DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS + 1 }, (_, index) => {
        const path = `/workspace/z-${index}.ts`;
        return [path, dirtyDocument(path, index === 0 ? "dirty" : "saved", "saved")];
      }),
    );

    const snapshot = collectDirtyTextSearchDocuments("/workspace", documents);

    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.overflow).toBe(true);
  });
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

function dirtyDocument(path: string, content: string, savedContent: string): EditorDocument {
  return {
    content,
    language: "typescript",
    name: path.split("/").pop() ?? path,
    path,
    savedContent,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
