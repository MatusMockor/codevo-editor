// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  FILES_SEARCH_DEBOUNCE_MS,
  MAX_FILES_SEARCH_RESULTS,
  useAgentFilesSearch,
  type AgentFilesSearch,
} from "./useAgentFilesSearch";

let ui: MountedUi | null = null;
const box: { current: AgentFilesSearch | null } = { current: null };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
  vi.useRealTimers();
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface SearchCall {
  readonly root: string;
  readonly query: string;
  readonly limit: number;
}

interface ScriptedSearch extends FileSearchGateway {
  readonly calls: SearchCall[];
  readonly pending: Deferred<FileSearchResult[]>[];
}

function scriptedSearch(): ScriptedSearch {
  const calls: SearchCall[] = [];
  const pending: Deferred<FileSearchResult[]>[] = [];
  return {
    calls,
    pending,
    searchFiles(root, query, limit) {
      calls.push({ root, query, limit });
      const next = deferred<FileSearchResult[]>();
      pending.push(next);
      return next.promise;
    },
  };
}

function result(relativePath: string, root = "/repo"): FileSearchResult {
  return {
    name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    path: `${root}/${relativePath}`,
    relativePath,
  };
}

function Probe(props: {
  readonly gateway: FileSearchGateway | null;
  readonly root: string | null;
  readonly query: string;
}) {
  box.current = useAgentFilesSearch(props);
  return null;
}

function render(gateway: FileSearchGateway | null, root: string | null, query: string): void {
  ui = ui ?? mountUi();
  ui.render(<Probe gateway={gateway} query={query} root={root} />);
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useAgentFilesSearch", () => {
  it("stays idle for an empty or blank query and never calls the gateway", async () => {
    const gateway = scriptedSearch();
    render(gateway, "/repo", "");
    await elapse(FILES_SEARCH_DEBOUNCE_MS * 2);
    render(gateway, "/repo", "   ");
    await elapse(FILES_SEARCH_DEBOUNCE_MS * 2);

    expect(gateway.calls).toEqual([]);
    expect(box.current).toEqual({ status: "idle", results: [], truncated: false, message: null });
  });

  it("debounces typing into one bounded search and caps the results", async () => {
    const gateway = scriptedSearch();
    render(gateway, "/repo", "i");
    await elapse(50);
    render(gateway, "/repo", "id");
    await elapse(50);
    render(gateway, "/repo", " idem ");

    expect(box.current?.status).toBe("searching");
    await elapse(FILES_SEARCH_DEBOUNCE_MS - 1);
    expect(gateway.calls).toEqual([]);
    await elapse(1);

    expect(gateway.calls).toEqual([
      { root: "/repo", query: "idem", limit: MAX_FILES_SEARCH_RESULTS + 1 },
    ]);
    const found = Array.from({ length: MAX_FILES_SEARCH_RESULTS + 1 }, (_, index) =>
      result(`src/idem${index}.ts`),
    );
    await act(async () => gateway.pending[0]?.resolve(found));

    expect(box.current?.status).toBe("ready");
    expect(box.current?.results).toHaveLength(MAX_FILES_SEARCH_RESULTS);
    expect(box.current?.results[0]).toEqual(result("src/idem0.ts"));
    expect(box.current?.truncated).toBe(true);
    expect(box.current?.message).toBeNull();
  });

  it("ignores a slower superseded query that resolves after the latest one", async () => {
    const gateway = scriptedSearch();
    render(gateway, "/repo", "app");
    await elapse(FILES_SEARCH_DEBOUNCE_MS);
    render(gateway, "/repo", "apple");
    await elapse(FILES_SEARCH_DEBOUNCE_MS);

    await act(async () => gateway.pending[1]?.resolve([result("src/apple.ts")]));
    await act(async () => gateway.pending[0]?.resolve([result("src/app.ts")]));

    expect(gateway.calls.map((call) => call.query)).toEqual(["app", "apple"]);
    expect(box.current).toEqual({
      status: "ready",
      results: [result("src/apple.ts")],
      truncated: false,
      message: null,
    });
  });

  it("clears results on a root switch and never publishes the previous root's late result", async () => {
    const gateway = scriptedSearch();
    render(gateway, "/a", "main");
    await elapse(FILES_SEARCH_DEBOUNCE_MS);
    await act(async () => gateway.pending[0]?.resolve([result("main.ts", "/a")]));
    expect(box.current?.results).toEqual([result("main.ts", "/a")]);

    render(gateway, "/b", "main");
    expect(box.current?.results).toEqual([]);
    expect(box.current?.status).toBe("searching");
    await elapse(FILES_SEARCH_DEBOUNCE_MS);
    render(gateway, "/a", "main");
    await elapse(FILES_SEARCH_DEBOUNCE_MS);
    await act(async () => gateway.pending[1]?.resolve([result("main.ts", "/b")]));

    expect(box.current?.results).toEqual([]);
    expect(box.current?.status).toBe("searching");
    await act(async () => gateway.pending[2]?.resolve([result("main.ts", "/a")]));
    expect(box.current?.results).toEqual([result("main.ts", "/a")]);
  });

  it("reports a rejected search as failed with its message", async () => {
    const gateway = scriptedSearch();
    render(gateway, "/repo", "idem");
    await elapse(FILES_SEARCH_DEBOUNCE_MS);

    await act(async () => gateway.pending[0]?.reject(new Error("Search is unavailable.")));

    expect(box.current).toEqual({
      status: "failed",
      results: [],
      truncated: false,
      message: "Search is unavailable.",
    });
  });

  it("stays idle without a gateway or root", async () => {
    render(null, "/repo", "idem");
    await elapse(FILES_SEARCH_DEBOUNCE_MS);
    expect(box.current?.status).toBe("idle");

    const gateway = scriptedSearch();
    render(gateway, null, "idem");
    await elapse(FILES_SEARCH_DEBOUNCE_MS);
    expect(box.current?.status).toBe("idle");
    expect(gateway.calls).toEqual([]);
  });

  it("drops a pending search when unmounted", async () => {
    const gateway = scriptedSearch();
    render(gateway, "/repo", "idem");
    ui?.unmount();
    ui = null;
    await elapse(FILES_SEARCH_DEBOUNCE_MS * 2);

    expect(gateway.calls).toEqual([]);
  });
});
