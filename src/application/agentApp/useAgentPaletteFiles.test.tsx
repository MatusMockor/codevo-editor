// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";
import {
  AGENT_PALETTE_FILE_DEBOUNCE_MS,
  AGENT_PALETTE_FILE_LIMIT,
  useAgentPaletteFiles,
} from "./useAgentPaletteFiles";

type PaletteFiles = ReturnType<typeof useAgentPaletteFiles>;

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  vi.useRealTimers();
});

function result(root: string, name: string): FileSearchResult {
  return { name, path: `${root}/${name}`, relativePath: name };
}

function renderFiles(gateway: FileSearchGateway, root: string | null, active = true) {
  const captured: { current: PaletteFiles | null } = { current: null };
  function Probe(props: { readonly root: string | null; readonly active: boolean }) {
    captured.current = useAgentPaletteFiles({
      active: props.active,
      fileSearch: gateway,
      workspaceRoot: props.root,
    });
    return null;
  }
  const host = createRoot(document.createElement("div"));
  act(() => host.render(<Probe active={active} root={root} />));
  unmounts.push(() => act(() => host.unmount()));
  return {
    current: () => captured.current as PaletteFiles,
    rerender: (nextRoot: string | null, nextActive = true) =>
      act(() => host.render(<Probe active={nextActive} root={nextRoot} />)),
  };
}

async function flushDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AGENT_PALETTE_FILE_DEBOUNCE_MS);
  });
}

describe("useAgentPaletteFiles", () => {
  it("searches the active project after the debounce and keeps the location request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const gateway: FileSearchGateway = {
      searchFiles: vi.fn(async (root: string) => [result(root, "orders.ts")]),
    };
    const files = renderFiles(gateway, "/workspace-a");

    act(() => files.current().onChangeQuery("orders:12"));
    expect(files.current().isLoading).toBe(true);
    expect(gateway.searchFiles).not.toHaveBeenCalled();
    await flushDebounce();

    expect(gateway.searchFiles).toHaveBeenCalledExactlyOnceWith(
      "/workspace-a",
      "orders",
      AGENT_PALETTE_FILE_LIMIT,
    );
    expect(files.current().results).toEqual([result("/workspace-a", "orders.ts")]);
    expect(files.current().isLoading).toBe(false);
    expect(files.current().request).toEqual({
      column: null,
      kind: "fileLocation",
      line: 12,
      pathQuery: "orders",
    });
  });

  it("drops a late result after the project switches and clears the query", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settle!: (value: FileSearchResult[]) => void;
    const gateway: FileSearchGateway = {
      searchFiles: vi.fn(
        () =>
          new Promise<FileSearchResult[]>((resolve) => {
            settle = resolve;
          }),
      ),
    };
    const files = renderFiles(gateway, "/workspace-a");
    act(() => files.current().onChangeQuery("orders"));
    await flushDebounce();

    files.rerender("/workspace-b");
    await act(async () => settle([result("/workspace-a", "orders.ts")]));

    expect(files.current().query).toBe("");
    expect(files.current().results).toEqual([]);
  });

  it("does not search while the palette is closed and reports truncation from metadata", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const gateway: FileSearchGateway = {
      searchFiles: vi.fn(async () => []),
      searchFilesWithMetadata: vi.fn(async (root: string) => ({
        requestGeneration: "g",
        results: [result(root, "a.ts")],
        truncated: true,
      })),
    };
    const files = renderFiles(gateway, "/workspace-a", false);
    act(() => files.current().onChangeQuery("a"));
    await flushDebounce();
    expect(gateway.searchFilesWithMetadata).not.toHaveBeenCalled();

    files.rerender("/workspace-a", true);
    act(() => files.current().onChangeQuery("a"));
    await flushDebounce();

    expect(files.current().isTruncated).toBe(true);
    expect(files.current().results).toEqual([result("/workspace-a", "a.ts")]);
  });
});
