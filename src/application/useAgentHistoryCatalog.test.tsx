// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogProject, catalogThread } from "../test/agentHistoryCatalogFixtures";
import type { AgentHistoryThreadPage } from "../domain/agentHistoryCatalog";
import type { AgentHistoryTurnPage } from "../domain/agentHistory";
import { useAgentHistoryCatalog, type AgentHistoryCatalogSurface } from "./useAgentHistoryCatalog";
let root: Root;
afterEach(() => {
  if (root) act(() => root.unmount());
});
function setup() {
  let projects = [catalogProject];
  const read = vi.fn<(request: unknown) => Promise<AgentHistoryThreadPage>>().mockResolvedValue({
    threads: [catalogThread()],
    beforeThreadId: catalogThread().threadId,
    hasEarlier: true,
  });
  const turns = vi
    .fn<(request: unknown) => Promise<AgentHistoryTurnPage>>()
    .mockResolvedValue({ turns: [], beforeTurnId: null, hasEarlier: false, revision: 7 });
  const restore = vi.fn().mockResolvedValue(true);
  const report = vi.fn();
  let surface: AgentHistoryCatalogSurface;
  function Harness() {
    surface = useAgentHistoryCatalog({
      projects,
      gateway: { readAgentHistoryThreads: read, readAgentHistoryTurns: turns },
      currentState: () => ({ threads: new Map() }),
      restoreThread: restore,
      reportError: report,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
  return {
    read,
    turns,
    restore,
    report,
    get surface() {
      return surface;
    },
    replace(next: typeof projects) {
      projects = next;
      act(() => root.render(<Harness />));
    },
  };
}
describe("saved conversation browsing", () => {
  it("replaces pages and restores the latest tail with current project ownership", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.read.mockResolvedValueOnce({
      threads: [catalogThread("agt-2-0a1b")],
      beforeThreadId: "agt-2-0a1b",
      hasEarlier: false,
    });
    await act(() => h.surface.older());
    expect(h.surface.page?.threads.map((thread) => thread.threadId)).toEqual(["agt-2-0a1b"]);
    expect(h.read.mock.calls[1][0]).toMatchObject({ beforeThreadId: "agt-1-0a1b" });
    await act(async () => {
      expect(await h.surface.open("agt-2-0a1b")).toBe(true);
    });
    expect(h.turns).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "agt-2-0a1b", beforeTurnId: null }),
    );
    expect(h.restore).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ ownerId: catalogProject.ownerId }),
        turnsTruncated: false,
        historyRevision: 7,
      }),
    );
  });
  it("refuses to grant newer revision authority to an outdated catalog header", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.turns.mockResolvedValueOnce({
      turns: [],
      beforeTurnId: null,
      hasEarlier: false,
      revision: 8,
    });
    await act(async () => {
      expect(await h.surface.open(catalogThread().threadId)).toBe(false);
    });
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.surface.page?.error).toContain("Refresh saved conversations");
  });
  it("rejects pending A-B-A results even when A descriptor is reused", async () => {
    const h = setup();
    let resolve!: (page: AgentHistoryThreadPage) => void;
    h.read.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = h.surface.choose(catalogProject.rootKey);
    });
    h.replace([{ ...catalogProject, rootKey: "/other" }]);
    h.replace([catalogProject]);
    await act(async () => {
      resolve({
        threads: [catalogThread()],
        beforeThreadId: catalogThread().threadId,
        hasEarlier: false,
      });
      await pending;
    });
    expect(h.surface.page).toBeNull();
  });
  it("does not restore after project changes while latest turns load", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    let resolve!: (page: AgentHistoryTurnPage) => void;
    h.turns.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let opening!: Promise<boolean>;
    act(() => {
      opening = h.surface.open(catalogThread().threadId);
    });
    h.replace([{ ...catalogProject, generation: 2 }]);
    await act(async () => {
      resolve({ turns: [], beforeTurnId: null, hasEarlier: false, revision: 7 });
      expect(await opening).toBe(false);
    });
    expect(h.restore).not.toHaveBeenCalled();
  });
  it("ignores an older opening when a newer selection settles first", async () => {
    const h = setup();
    h.read.mockResolvedValueOnce({
      threads: [catalogThread(), catalogThread("agt-2-0a1b")],
      beforeThreadId: "agt-2-0a1b",
      hasEarlier: false,
    });
    await act(() => h.surface.choose(catalogProject.rootKey));
    let resolve!: (page: AgentHistoryTurnPage) => void;
    h.turns.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let first!: Promise<boolean>;
    act(() => {
      first = h.surface.open(catalogThread().threadId);
    });
    await act(async () => {
      expect(await h.surface.open("agt-2-0a1b")).toBe(true);
    });
    await act(async () => {
      resolve({ turns: [], beforeTurnId: null, hasEarlier: false, revision: 7 });
      expect(await first).toBe(false);
    });
    expect(h.restore).toHaveBeenCalledOnce();
    expect(h.restore).toHaveBeenCalledWith(expect.objectContaining({ threadId: "agt-2-0a1b" }));
  });
  it("does not navigate after close while restoration is settling", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    let resolve!: (value: boolean) => void;
    h.restore.mockReturnValueOnce(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    let opening!: Promise<boolean>;
    await act(async () => {
      opening = h.surface.open(catalogThread().threadId);
    });
    expect(h.restore).toHaveBeenCalledOnce();
    act(() => h.surface.close());
    await act(async () => {
      resolve(true);
      expect(await opening).toBe(false);
    });
  });
  it("shows restoration failure instead of silently ignoring the selection", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.restore.mockResolvedValueOnce(false);
    await act(async () => {
      expect(await h.surface.open(catalogThread().threadId)).toBe(false);
    });
    expect(h.surface.page?.error).toContain("Could not open");
  });
  it("keeps errors retryable and ignores errors after closing", async () => {
    const h = setup();
    h.read.mockRejectedValueOnce(new Error("broken"));
    await act(() => h.surface.choose(catalogProject.rootKey));
    expect(h.surface.page?.error).toContain("Try again");
    expect(h.report).toHaveBeenCalledOnce();
    await act(() => h.surface.latest());
    expect(h.surface.page?.error).toBeNull();
    act(() => h.surface.close());
    expect(h.surface.page).toBeNull();
  });
});
