// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchGateway, FileSearchResponse } from "../../domain/workspace";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { usePaletteRootFiles } from "./usePaletteRootFiles";

let ui: MountedUi | null = null;
let latest: readonly { path: string }[] = [];

function Harness(props: { gateway: FileSearchGateway; root: string | null; query: string }) {
  latest = usePaletteRootFiles({ ...props, enabled: true });
  return null;
}

function deferred() {
  let resolve: (value: FileSearchResponse) => void = () => undefined;
  const promise = new Promise<FileSearchResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  ui?.unmount();
  ui = null;
  latest = [];
  vi.useRealTimers();
});

describe("usePaletteRootFiles", () => {
  it("debounces, requests five results and drops responses for a stale query or root", async () => {
    const first = deferred();
    const second = deferred();
    const searchFilesWithMetadata = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const gateway: FileSearchGateway = { searchFiles: vi.fn(), searchFilesWithMetadata };
    ui = mountUi();

    ui.render(<Harness gateway={gateway} query="ord" root="/a" />);
    await act(async () => vi.advanceTimersByTime(100));
    ui.render(<Harness gateway={gateway} query="ord" root="/b" />);
    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => {
      first.resolve({
        requestGeneration: "1",
        results: [{ name: "a.ts", path: "/a/a.ts", relativePath: "a.ts" }],
        truncated: false,
      });
    });
    expect(latest).toEqual([]);
    await act(async () => {
      second.resolve({
        requestGeneration: "2",
        results: [{ name: "b.ts", path: "/b/b.ts", relativePath: "b.ts" }],
        truncated: false,
      });
    });
    expect(latest.map((file) => file.path)).toEqual(["/b/b.ts"]);
    expect(searchFilesWithMetadata).toHaveBeenCalledWith("/b", "ord", 5, expect.any(String));
  });

  it("keeps one search in flight and runs only the latest queued query afterwards", async () => {
    const first = deferred();
    const latestResponse = deferred();
    const searchFilesWithMetadata = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latestResponse.promise);
    const gateway: FileSearchGateway = { searchFiles: vi.fn(), searchFilesWithMetadata };
    ui = mountUi();

    ui.render(<Harness gateway={gateway} query="o" root="/a" />);
    await act(async () => vi.advanceTimersByTime(100));
    ui.render(<Harness gateway={gateway} query="or" root="/a" />);
    await act(async () => vi.advanceTimersByTime(100));
    ui.render(<Harness gateway={gateway} query="ord" root="/a" />);
    await act(async () => vi.advanceTimersByTime(100));
    expect(searchFilesWithMetadata).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ requestGeneration: "1", results: [], truncated: false });
    });
    expect(searchFilesWithMetadata).toHaveBeenCalledTimes(2);
    expect(searchFilesWithMetadata).toHaveBeenLastCalledWith("/a", "ord", 5, expect.any(String));

    await act(async () => {
      latestResponse.resolve({
        requestGeneration: "2",
        results: [{ name: "ord.ts", path: "/a/ord.ts", relativePath: "ord.ts" }],
        truncated: false,
      });
    });
    expect(latest.map((file) => file.path)).toEqual(["/a/ord.ts"]);
  });

  it("drops a queued search when the palette unmounts", async () => {
    const first = deferred();
    const searchFilesWithMetadata = vi.fn().mockReturnValueOnce(first.promise);
    const gateway: FileSearchGateway = { searchFiles: vi.fn(), searchFilesWithMetadata };
    ui = mountUi();

    ui.render(<Harness gateway={gateway} query="o" root="/a" />);
    await act(async () => vi.advanceTimersByTime(100));
    ui.render(<Harness gateway={gateway} query="or" root="/a" />);
    await act(async () => vi.advanceTimersByTime(100));
    ui.unmount();
    ui = null;
    await act(async () => {
      first.resolve({ requestGeneration: "1", results: [], truncated: false });
    });

    expect(searchFilesWithMetadata).toHaveBeenCalledTimes(1);
  });

  it("does not search for an empty or prefixed query", async () => {
    const searchFilesWithMetadata = vi.fn();
    const gateway: FileSearchGateway = { searchFiles: vi.fn(), searchFilesWithMetadata };
    ui = mountUi();
    ui.render(<Harness gateway={gateway} query="  " root="/a" />);
    ui.render(<Harness gateway={gateway} query=">tog" root="/a" />);
    ui.render(<Harness gateway={gateway} query="@tog" root="/a" />);
    await act(async () => vi.advanceTimersByTime(200));
    expect(searchFilesWithMetadata).not.toHaveBeenCalled();
  });
});
