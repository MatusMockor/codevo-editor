// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DIRECTORY_FILTER_QUERY_CHARS,
  type DirectoryEntry,
  type DirectoryListing,
  type DirectoryListingGateway,
  type DirectoryListingRequest,
} from "../domain/directoryListing";
import {
  DIRECTORY_BROWSER_LOAD_FAILED,
  MAX_DIRECTORY_BROWSER_HISTORY,
  useDirectoryBrowser,
  type DirectoryBrowserOptions,
  type DirectoryBrowserSurface,
} from "./useDirectoryBrowser";

const HOME = "/Users/dev";

interface PendingLoad {
  readonly path: string | null;
  readonly resolve: (listing: DirectoryListing) => void;
  readonly reject: (error: unknown) => void;
}

interface TestGateway {
  readonly gateway: DirectoryListingGateway;
  readonly requests: Array<DirectoryListingRequest>;
  readonly pending: Array<PendingLoad>;
  readonly revealed: Array<string>;
}

function createTestGateway(): TestGateway {
  const requests: Array<DirectoryListingRequest> = [];
  const pending: Array<PendingLoad> = [];
  const revealed: Array<string> = [];
  const gateway: DirectoryListingGateway = {
    listDirectoryEntries(request) {
      requests.push(request);
      return new Promise<DirectoryListing>((resolve, reject) => {
        pending.push({ path: request.path, resolve, reject });
      });
    },
    revealDirectory(path) {
      revealed.push(path);
      return Promise.resolve();
    },
  };
  return { gateway, requests, pending, revealed };
}

function parentOf(path: string): string | null {
  if (path === "/") return null;
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index);
}

function listingFor(path: string, entries: ReadonlyArray<DirectoryEntry> = []): DirectoryListing {
  return { path, parent: parentOf(path), entries, truncated: false };
}

function entry(name: string, kind: DirectoryEntry["kind"], hidden = false): DirectoryEntry {
  return { name, kind, hidden };
}

interface BrowserHarness {
  readonly current: DirectoryBrowserSurface;
  readonly renders: number;
  unmount(): void;
}

function renderBrowser(
  gateway: DirectoryListingGateway,
  options?: DirectoryBrowserOptions,
): BrowserHarness {
  const host = document.createElement("div");
  const root = createRoot(host);
  let surface!: DirectoryBrowserSurface;
  let renders = 0;

  function Harness() {
    renders += 1;
    surface = useDirectoryBrowser(gateway, options);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    get current() {
      return surface;
    },
    get renders() {
      return renders;
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

async function settleNext(state: TestGateway, listing: DirectoryListing): Promise<void> {
  const load = state.pending.shift();
  expect(load).toBeDefined();
  await act(async () => {
    load?.resolve(listing);
  });
}

async function failNext(state: TestGateway, error: unknown): Promise<void> {
  const load = state.pending.shift();
  expect(load).toBeDefined();
  await act(async () => {
    load?.reject(error);
  });
}

async function mountLoaded(
  entries: ReadonlyArray<DirectoryEntry> = [],
  options?: DirectoryBrowserOptions,
): Promise<{ state: TestGateway; ui: BrowserHarness }> {
  const state = createTestGateway();
  const ui = renderBrowser(state.gateway, options);
  await settleNext(state, listingFor(HOME, entries));
  return { state, ui };
}

function navigate(ui: BrowserHarness, path: string): void {
  act(() => {
    ui.current.navigateTo(path);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDirectoryBrowser", () => {
  it("loads the home directory on mount", async () => {
    const state = createTestGateway();
    const ui = renderBrowser(state.gateway);

    expect(ui.current.status).toBe("loading");
    expect(ui.current.listing).toBeNull();
    expect(state.requests).toEqual([{ path: null, includeFiles: false }]);

    await settleNext(state, listingFor(HOME, [entry("projects", "directory")]));

    expect(ui.current.status).toBe("loaded");
    expect(ui.current.listing?.path).toBe(HOME);
    expect(ui.current.homePath).toBe(HOME);
    expect(ui.current.canGoBack).toBe(false);
    expect(ui.current.error).toBeNull();
    ui.unmount();
  });

  it("loads an explicit initial path without adopting it as home", async () => {
    const state = createTestGateway();
    const ui = renderBrowser(state.gateway, { initialPath: "/var/log", includeFiles: true });

    expect(state.requests).toEqual([{ path: "/var/log", includeFiles: true }]);

    await settleNext(state, listingFor("/var/log"));

    expect(ui.current.listing?.path).toBe("/var/log");
    expect(ui.current.homePath).toBeNull();
    ui.unmount();
  });

  it("navigates to a path, records history, and clears the query", async () => {
    const { state, ui } = await mountLoaded();

    act(() => {
      ui.current.setQuery("proj");
    });
    navigate(ui, "/Users/dev/projects");

    expect(ui.current.status).toBe("loading");
    expect(ui.current.query).toBe("");
    expect(ui.current.canGoBack).toBe(true);
    expect(ui.current.listing?.path).toBe(HOME);

    await settleNext(state, listingFor("/Users/dev/projects"));

    expect(ui.current.status).toBe("loaded");
    expect(ui.current.listing?.path).toBe("/Users/dev/projects");
    expect(state.requests).toEqual([
      { path: null, includeFiles: false },
      { path: "/Users/dev/projects", includeFiles: false },
    ]);
    ui.unmount();
  });

  it("restores the previous directory on goBack without pushing history", async () => {
    const { state, ui } = await mountLoaded();

    navigate(ui, "/Users/dev/projects");
    await settleNext(state, listingFor("/Users/dev/projects"));

    act(() => {
      ui.current.goBack();
    });

    expect(ui.current.canGoBack).toBe(false);

    await settleNext(state, listingFor(HOME));

    expect(ui.current.listing?.path).toBe(HOME);
    expect(ui.current.canGoBack).toBe(false);
    expect(state.requests.map((request) => request.path)).toEqual([
      null,
      "/Users/dev/projects",
      HOME,
    ]);
    ui.unmount();
  });

  it("ignores goBack without history", async () => {
    const { state, ui } = await mountLoaded();

    act(() => {
      ui.current.goBack();
    });

    expect(state.requests).toHaveLength(1);
    expect(ui.current.status).toBe("loaded");
    ui.unmount();
  });

  it("builds descend paths for nested directories and the filesystem root", async () => {
    const { state, ui } = await mountLoaded([entry("projects", "directory")]);

    act(() => {
      ui.current.descend("projects");
    });
    await settleNext(state, listingFor("/Users/dev/projects"));

    expect(ui.current.listing?.path).toBe("/Users/dev/projects");

    navigate(ui, "/");
    await settleNext(state, listingFor("/", [entry("usr", "directory")]));

    act(() => {
      ui.current.descend("usr");
    });

    expect(state.requests.map((request) => request.path)).toEqual([
      null,
      "/Users/dev/projects",
      "/",
      "/usr",
    ]);
    ui.unmount();
  });

  it("ascends to the parent and ignores ascend at the root", async () => {
    const { state, ui } = await mountLoaded();

    act(() => {
      ui.current.ascend();
    });
    await settleNext(state, listingFor("/Users"));

    expect(ui.current.listing?.path).toBe("/Users");

    act(() => {
      ui.current.ascend();
    });
    await settleNext(state, listingFor("/"));

    expect(ui.current.listing?.parent).toBeNull();

    act(() => {
      ui.current.ascend();
    });

    expect(state.requests.map((request) => request.path)).toEqual([null, "/Users", "/"]);
    ui.unmount();
  });

  it("reloads the current path", async () => {
    const { state, ui } = await mountLoaded();

    navigate(ui, "/Users/dev/projects");
    await settleNext(state, listingFor("/Users/dev/projects"));

    act(() => {
      ui.current.reload();
    });

    expect(ui.current.status).toBe("loading");
    await settleNext(state, listingFor("/Users/dev/projects", [entry("api", "directory")]));

    expect(ui.current.visibleEntries.map((item) => item.name)).toEqual(["api"]);
    expect(state.requests.map((request) => request.path)).toEqual([
      null,
      "/Users/dev/projects",
      "/Users/dev/projects",
    ]);
    ui.unmount();
  });

  it("keeps the previous listing on failure and still allows going back", async () => {
    const { state, ui } = await mountLoaded();

    navigate(ui, "/Users/dev/projects");
    await settleNext(state, listingFor("/Users/dev/projects"));

    navigate(ui, "/Users/dev/missing");
    await failNext(state, new Error("Directory does not exist."));

    expect(ui.current.status).toBe("error");
    expect(ui.current.error).toBe("Directory does not exist.");
    expect(ui.current.listing?.path).toBe("/Users/dev/projects");
    expect(ui.current.canGoBack).toBe(true);

    act(() => {
      ui.current.goBack();
    });
    await settleNext(state, listingFor("/Users/dev/projects"));

    expect(ui.current.status).toBe("loaded");
    expect(ui.current.error).toBeNull();
    expect(ui.current.listing?.path).toBe("/Users/dev/projects");
    expect(ui.current.canGoBack).toBe(true);
    ui.unmount();
  });

  it("falls back to a bounded message for a non-error rejection", async () => {
    const { state, ui } = await mountLoaded();

    navigate(ui, "/root");
    await failNext(state, { code: "EACCES" });

    expect(ui.current.status).toBe("error");
    expect(ui.current.error).toBe(DIRECTORY_BROWSER_LOAD_FAILED);
    ui.unmount();
  });

  it("drops a superseded load that settles last", async () => {
    const { state, ui } = await mountLoaded();

    navigate(ui, "/first");
    navigate(ui, "/second");

    const first = state.pending[0];
    const second = state.pending[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    await act(async () => {
      second?.resolve(listingFor("/second"));
    });
    await act(async () => {
      first?.resolve(listingFor("/first"));
    });

    expect(ui.current.status).toBe("loaded");
    expect(ui.current.listing?.path).toBe("/second");
    ui.unmount();
  });

  it("drops a superseded failure that settles last", async () => {
    const { state, ui } = await mountLoaded();

    navigate(ui, "/first");
    navigate(ui, "/second");

    const first = state.pending[0];
    const second = state.pending[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    await act(async () => {
      second?.resolve(listingFor("/second"));
    });
    await act(async () => {
      first?.reject(new Error("Directory does not exist."));
    });

    expect(ui.current.status).toBe("loaded");
    expect(ui.current.error).toBeNull();
    expect(ui.current.listing?.path).toBe("/second");
    ui.unmount();
  });

  it("performs no state update when a load settles after unmount", async () => {
    const consoleError = vi.spyOn(console, "error");
    const state = createTestGateway();
    const ui = renderBrowser(state.gateway);
    const rendersBeforeUnmount = ui.renders;

    ui.unmount();

    const load = state.pending[0];
    expect(load).toBeDefined();
    await act(async () => {
      load?.resolve(listingFor(HOME));
    });

    expect(ui.renders).toBe(rendersBeforeUnmount);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("performs no state update when a load rejects after unmount", async () => {
    const consoleError = vi.spyOn(console, "error");
    const state = createTestGateway();
    const ui = renderBrowser(state.gateway);
    const rendersBeforeUnmount = ui.renders;

    ui.unmount();

    const load = state.pending[0];
    expect(load).toBeDefined();
    await act(async () => {
      load?.reject(new Error("Directory does not exist."));
    });

    expect(ui.renders).toBe(rendersBeforeUnmount);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("filters visible entries by query and hidden state and sorts directories first", async () => {
    const entries = [
      entry("Zeta.ts", "file"),
      entry("beta", "directory"),
      entry("Alpha", "symlink"),
      entry(".git", "directory", true),
      entry(".env", "file", true),
      entry("alpha.ts", "file"),
    ];
    const { ui } = await mountLoaded(entries, { includeFiles: true });

    expect(ui.current.visibleEntries.map((item) => item.name)).toEqual([
      "Alpha",
      "beta",
      "alpha.ts",
      "Zeta.ts",
    ]);

    act(() => {
      ui.current.setShowHidden(true);
    });

    expect(ui.current.showHidden).toBe(true);
    expect(ui.current.visibleEntries.map((item) => item.name)).toEqual([
      ".git",
      "Alpha",
      "beta",
      ".env",
      "alpha.ts",
      "Zeta.ts",
    ]);

    act(() => {
      ui.current.setQuery("  AL  ");
    });

    expect(ui.current.visibleEntries.map((item) => item.name)).toEqual(["Alpha", "alpha.ts"]);
    ui.unmount();
  });

  it("excludes files from visible entries unless files are included", async () => {
    const entries = [entry("api", "directory"), entry("readme.md", "file")];
    const { ui } = await mountLoaded(entries);

    expect(ui.current.visibleEntries.map((item) => item.name)).toEqual(["api"]);
    ui.unmount();
  });

  it("caps the query at the bounded character count", async () => {
    const { ui } = await mountLoaded();

    act(() => {
      ui.current.setQuery("q".repeat(MAX_DIRECTORY_FILTER_QUERY_CHARS + 40));
    });

    expect(ui.current.query).toHaveLength(MAX_DIRECTORY_FILTER_QUERY_CHARS);
    ui.unmount();
  });

  it("bounds the history to the newest entries", async () => {
    const { state, ui } = await mountLoaded();
    const depth = MAX_DIRECTORY_BROWSER_HISTORY + 5;

    for (let index = 0; index < depth; index += 1) {
      const path = `/step-${index}`;
      navigate(ui, path);
      await settleNext(state, listingFor(path));
    }

    let pops = 0;
    while (ui.current.canGoBack) {
      act(() => {
        ui.current.goBack();
      });
      pops += 1;
      expect(pops).toBeLessThanOrEqual(MAX_DIRECTORY_BROWSER_HISTORY);
    }

    expect(pops).toBe(MAX_DIRECTORY_BROWSER_HISTORY);
    ui.unmount();
  });
});
