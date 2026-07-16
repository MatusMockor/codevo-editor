// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { usePhpSourceCollectionRegistry } from "./usePhpSourceCollectionRegistry";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const SOURCE_PATH = `${ROOT}/config/services.neon`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function renderRegistry(
  loadSources: () => Promise<readonly string[]>,
  currentWorkspaceRootRef = { current: ROOT as string | null },
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const onSourcesLoaded = vi.fn();
  let registry: ReturnType<typeof usePhpSourceCollectionRegistry> | null = null;

  function Harness() {
    registry = usePhpSourceCollectionRegistry({
      currentWorkspaceRootRef,
      isActive: true,
      isSourcePath: (_root, path) => path.endsWith(".neon"),
      loadSources,
      onSourcesLoaded,
      sourceSignature: (sources) => sources.join("|"),
      workspaceFiles: {
        readDirectory: vi.fn(async () => []),
        readTextFile: vi.fn(async () => ""),
      },
    });
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    api: () => {
      if (!registry) {
        throw new Error("registry hook not mounted");
      }
      return registry;
    },
    onSourcesLoaded,
    unmount: () => act(() => root.unmount()),
  };
}

describe("usePhpSourceCollectionRegistry", () => {
  it("coalesces source loads and invalidates bindings after publication", async () => {
    const load = deferred<readonly string[]>();
    const loadSources = vi.fn(() => load.promise);
    const harness = renderRegistry(loadSources);

    const first = harness.api().ensureSourceCollectionLoaded(ROOT);
    const coalesced = harness.api().ensureSourceCollectionLoaded(ROOT);
    expect(loadSources).toHaveBeenCalledOnce();

    load.resolve(["services: []"]);
    await act(async () => Promise.all([first, coalesced]));

    expect(harness.api().currentSourceCollectionEntry(ROOT)).toEqual({
      signature: "services: []",
      sources: ["services: []"],
    });
    expect(harness.onSourcesLoaded).toHaveBeenCalledWith(ROOT);
    harness.unmount();
  });

  it("does not let an invalidated load publish or clear its replacement", async () => {
    const stale = deferred<readonly string[]>();
    const current = deferred<readonly string[]>();
    const loadSources = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const harness = renderRegistry(loadSources);

    const staleLoad = harness.api().ensureSourceCollectionLoaded(ROOT);
    harness.api().invalidateSourceCollectionForPath(ROOT, SOURCE_PATH);
    const currentLoad = harness.api().ensureSourceCollectionLoaded(ROOT);

    stale.resolve(["stale"]);
    await act(async () => staleLoad);
    expect(harness.api().currentSourceCollectionEntry(ROOT)).toBeNull();

    current.resolve(["current"]);
    await act(async () => currentLoad);
    expect(harness.api().currentSourceCollectionEntry(ROOT)?.sources).toEqual([
      "current",
    ]);
    expect(harness.onSourcesLoaded).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("drops a completed source load after the workspace root changes", async () => {
    const load = deferred<readonly string[]>();
    const currentWorkspaceRootRef = { current: ROOT as string | null };
    const harness = renderRegistry(() => load.promise, currentWorkspaceRootRef);
    const loading = harness.api().ensureSourceCollectionLoaded(ROOT);

    currentWorkspaceRootRef.current = "/renamed-workspace";
    load.resolve(["stale"]);
    await act(async () => loading);

    expect(harness.api().currentSourceCollectionEntry(ROOT)).toBeNull();
    expect(harness.onSourcesLoaded).not.toHaveBeenCalled();
    harness.unmount();
  });
});
