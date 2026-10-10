// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogProject, catalogThread } from "../test/agentHistoryCatalogFixtures";
import type { AgentHistoryThreadPage } from "../domain/agentHistoryCatalog";
import type { AgentHistoryTurnPage } from "../domain/agentHistory";
import { MAX_AGENT_THREADS_PER_ROOT, runningTurn, type AgentThread } from "../domain/agentThread";
import { AgentThreadCleanupIncompleteError } from "./agentThreadPorts";
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
  const loaded = new Map<string, AgentThread>();
  const restore = vi.fn(async (thread: AgentThread) => {
    loaded.set(thread.threadId, thread);
    return true;
  });
  const renameThread = vi.fn((threadId: string, title: string) => {
    const thread = loaded.get(threadId);
    if (thread) loaded.set(threadId, { ...thread, title });
  });
  const setArchived = (archived: boolean) => (threadId: string) => {
    const thread = loaded.get(threadId);
    if (!thread || (archived && runningTurn(thread) !== null)) return false;
    loaded.set(threadId, { ...thread, archived });
    return true;
  };
  const archiveThread = vi.fn(setArchived(true));
  const unarchiveThread = vi.fn(setArchived(false));
  const removeThread = vi.fn((threadId: string) => loaded.delete(threadId));
  const deleteSavedThread = vi.fn<(thread: AgentThread) => Promise<void>>().mockResolvedValue();
  const report = vi.fn();
  let surface: AgentHistoryCatalogSurface;
  function Harness() {
    surface = useAgentHistoryCatalog({
      projects,
      gateway: { readAgentHistoryThreads: read, readAgentHistoryTurns: turns },
      currentState: () => ({ threads: loaded }),
      restoreThread: restore,
      renameThread,
      archiveThread,
      unarchiveThread,
      removeThread,
      deleteSavedThread,
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
    loaded,
    renameThread,
    archiveThread,
    unarchiveThread,
    removeThread,
    deleteSavedThread,
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
function pendingRead(h: ReturnType<typeof setup>) {
  let resolve!: (page: AgentHistoryThreadPage) => void;
  h.read.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  return (page: AgentHistoryThreadPage) => resolve(page);
}
const olderPage: AgentHistoryThreadPage = {
  threads: [catalogThread("agt-2-0a1b"), catalogThread("agt-3-0a1b")],
  beforeThreadId: "agt-3-0a1b",
  hasEarlier: false,
};
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
  it("is on the newest page after choosing or returning, and not after paging back", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    expect(h.surface.page?.atNewest).toBe(true);
    await act(() => h.surface.older());
    expect(h.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ beforeThreadId: catalogThread().threadId }),
    );
    expect(h.surface.page?.atNewest).toBe(false);
    await act(() => h.surface.older());
    expect(h.surface.page?.atNewest).toBe(false);
    await act(() => h.surface.latest());
    expect(h.read).toHaveBeenLastCalledWith(expect.objectContaining({ beforeThreadId: null }));
    expect(h.surface.page?.atNewest).toBe(true);
    await act(() => h.surface.older());
    await act(() => h.surface.choose(catalogProject.rootKey));
    expect(h.surface.page?.atNewest).toBe(true);
  });
  it("keeps the shown page's place while the next page loads", async () => {
    const h = setup();
    const page: AgentHistoryThreadPage = {
      threads: [catalogThread()],
      beforeThreadId: catalogThread().threadId,
      hasEarlier: true,
    };
    let settle = pendingRead(h);
    let pending!: Promise<void>;
    act(() => {
      pending = h.surface.choose(catalogProject.rootKey);
    });
    expect(h.surface.page).toMatchObject({ loading: true, atNewest: true });
    await act(async () => {
      settle(page);
      await pending;
    });
    expect(h.surface.page).toMatchObject({ loading: false, atNewest: true });

    settle = pendingRead(h);
    act(() => {
      pending = h.surface.older();
    });
    expect(h.surface.page).toMatchObject({ loading: true, atNewest: true });
    await act(async () => {
      settle(page);
      await pending;
    });
    expect(h.surface.page).toMatchObject({ loading: false, atNewest: false });

    settle = pendingRead(h);
    act(() => {
      pending = h.surface.latest();
    });
    expect(h.surface.page).toMatchObject({ loading: true, atNewest: false });
    await act(async () => {
      settle(page);
      await pending;
    });
    expect(h.surface.page).toMatchObject({ loading: false, atNewest: true });
  });
  it("keeps the shown page's place when the next read fails", async () => {
    const h = setup();
    h.read.mockRejectedValueOnce(new Error("broken"));
    await act(() => h.surface.choose(catalogProject.rootKey));
    expect(h.surface.page).toMatchObject({ atNewest: true, threads: [] });
    expect(h.surface.page?.error).toContain("Try again");

    await act(() => h.surface.latest());
    h.read.mockRejectedValueOnce(new Error("broken"));
    await act(() => h.surface.older());
    expect(h.surface.page?.error).toContain("Try again");
    expect(h.surface.page?.atNewest).toBe(true);

    await act(() => h.surface.older());
    expect(h.surface.page).toMatchObject({ atNewest: false, error: null });
    h.read.mockRejectedValueOnce(new Error("broken"));
    await act(() => h.surface.latest());
    expect(h.surface.page?.error).toContain("Try again");
    expect(h.surface.page?.atNewest).toBe(false);
  });
  it("keeps its place through a rename, an archive and a row removal", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.read.mockResolvedValueOnce(olderPage);
    await act(() => h.surface.older());
    expect(h.surface.page?.atNewest).toBe(false);
    await act(async () => {
      expect(await h.surface.rename("agt-2-0a1b", "Renamed")).toBe(true);
    });
    expect(h.surface.page?.atNewest).toBe(false);
    await act(async () => {
      expect(await h.surface.setArchived("agt-2-0a1b", true)).toBe(true);
    });
    expect(h.surface.page?.atNewest).toBe(false);
    let finish!: () => void;
    h.deleteSavedThread.mockReturnValueOnce(
      new Promise<void>((done) => {
        finish = done;
      }),
    );
    let removing!: Promise<boolean>;
    act(() => {
      removing = h.surface.remove("agt-3-0a1b");
    });
    expect(h.surface.page).toMatchObject({ deletingThreadId: "agt-3-0a1b", atNewest: false });
    await act(async () => {
      finish();
      expect(await removing).toBe(true);
    });
    expect(h.surface.page?.threads.map((thread) => thread.threadId)).toEqual(["agt-2-0a1b"]);
    expect(h.surface.page).toMatchObject({ deletingThreadId: null, atNewest: false });

    await act(() => h.surface.latest());
    await act(async () => {
      expect(await h.surface.remove(catalogThread().threadId)).toBe(true);
    });
    expect(h.surface.page?.atNewest).toBe(true);
  });
});

const runningTurnFixture = {
  turnId: "agt-1-0a1c",
  prompt: "work",
  status: { kind: "running" },
  startedAtEpochMs: 1,
  endedAtEpochMs: null,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 1,
  streamMetrics: null,
  launch: null,
  cliVersion: null,
} as unknown as AgentThread["turns"][number];

describe("saved conversation actions", () => {
  const rowIds = (h: ReturnType<typeof setup>) => h.surface.rows.map((row) => row.threadId);

  it("opens a conversation that is already loaded without a stale revision refusal", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.loaded.set(catalogThread().threadId, { ...catalogThread(), historyRevision: 99 });
    await act(async () => {
      expect(await h.surface.open(catalogThread().threadId)).toBe(true);
    });
    expect(h.turns).not.toHaveBeenCalled();
    expect(h.surface.page?.error).toBeNull();
  });

  it("deletes an unloaded conversation through the saved delete path with the runtime owner", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.read.mockResolvedValueOnce({ threads: [], beforeThreadId: null, hasEarlier: false });
    await act(async () => {
      expect(await h.surface.remove(catalogThread().threadId)).toBe(true);
    });
    expect(h.deleteSavedThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: catalogThread().threadId,
        owner: expect.objectContaining({ ownerId: catalogProject.ownerId }),
      }),
    );
    expect(h.removeThread).not.toHaveBeenCalled();
    expect(rowIds(h)).toEqual([]);
  });

  it("deletes a loaded conversation through the live thread delete path", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.read.mockResolvedValueOnce({ threads: [], beforeThreadId: null, hasEarlier: false });
    h.loaded.set(catalogThread().threadId, catalogThread());
    await act(async () => {
      expect(await h.surface.remove(catalogThread().threadId)).toBe(true);
    });
    expect(h.removeThread).toHaveBeenCalledWith(catalogThread().threadId);
    expect(h.deleteSavedThread).not.toHaveBeenCalled();
    expect(rowIds(h)).toEqual([]);
  });

  it("refuses to delete a running conversation and says why", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.loaded.set(catalogThread().threadId, { ...catalogThread(), turns: [runningTurnFixture] });
    await act(async () => {
      expect(await h.surface.remove(catalogThread().threadId)).toBe(false);
    });
    expect(h.removeThread).not.toHaveBeenCalled();
    expect(h.deleteSavedThread).not.toHaveBeenCalled();
    expect(h.surface.page?.error).toBe("Stop the agent before deleting this conversation.");
    expect(h.surface.rows[0]?.running).toBe(true);
    expect(rowIds(h)).toEqual([catalogThread().threadId]);
  });

  it("keeps the row and shows the backend reason when delete fails", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.deleteSavedThread.mockRejectedValueOnce(new Error("Attachments could not be removed."));
    await act(async () => {
      expect(await h.surface.remove(catalogThread().threadId)).toBe(false);
    });
    expect(h.surface.page?.error).toBe(
      "Could not delete this conversation: Attachments could not be removed.",
    );
    expect(h.surface.page?.loading).toBe(false);
    expect(h.report).toHaveBeenCalledOnce();
    expect(rowIds(h)).toEqual([catalogThread().threadId]);
  });

  it("does not publish a delete result after the project changes", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    let finish!: () => void;
    h.deleteSavedThread.mockReturnValueOnce(
      new Promise<void>((done) => {
        finish = done;
      }),
    );
    let removing!: Promise<boolean>;
    act(() => {
      removing = h.surface.remove(catalogThread().threadId);
    });
    h.replace([{ ...catalogProject, generation: 2 }]);
    await act(async () => {
      finish();
      await removing;
    });
    expect(h.surface.page).toBeNull();
  });

  it("renames by restoring the conversation and updating its row", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    await act(async () => {
      expect(await h.surface.rename(catalogThread().threadId, "  Telekom phone  ")).toBe(true);
    });
    expect(h.restore).toHaveBeenCalledOnce();
    expect(h.renameThread).toHaveBeenCalledWith(catalogThread().threadId, "Telekom phone");
    expect(h.surface.rows[0]?.title).toBe("Telekom phone");
    await act(async () => {
      expect(await h.surface.rename(catalogThread().threadId, "   ")).toBe(false);
    });
    expect(h.renameThread).toHaveBeenCalledOnce();
  });

  it("archives and unarchives through the thread store and reflects it in the row", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    await act(async () => {
      expect(await h.surface.setArchived(catalogThread().threadId, true)).toBe(true);
    });
    expect(h.surface.rows[0]?.archived).toBe(true);
    await act(async () => {
      expect(await h.surface.setArchived(catalogThread().threadId, false)).toBe(true);
    });
    expect(h.unarchiveThread).toHaveBeenCalledWith(catalogThread().threadId);
    expect(h.surface.rows[0]?.archived).toBe(false);
  });

  it("reports a refused archive instead of pretending it worked", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.loaded.set(catalogThread().threadId, { ...catalogThread(), turns: [runningTurnFixture] });
    await act(async () => {
      expect(await h.surface.setArchived(catalogThread().threadId, true)).toBe(false);
    });
    expect(h.surface.page?.error).toContain("Stop the agent first");
    expect(h.surface.rows[0]?.archived).toBe(false);
  });

  it("keeps the paging cursor on a row that still exists after deleting the last row", async () => {
    const h = setup();
    h.read.mockResolvedValueOnce({
      threads: [catalogThread(), catalogThread("agt-2-0a1b")],
      beforeThreadId: "agt-2-0a1b",
      hasEarlier: true,
    });
    await act(() => h.surface.choose(catalogProject.rootKey));
    await act(async () => {
      expect(await h.surface.remove("agt-2-0a1b")).toBe(true);
    });
    expect(h.surface.page?.beforeThreadId).toBe(catalogThread().threadId);
    expect(h.surface.page?.hasEarlier).toBe(true);
    h.read.mockResolvedValueOnce({
      threads: [catalogThread("agt-3-0a1b")],
      beforeThreadId: "agt-3-0a1b",
      hasEarlier: false,
    });
    await act(async () => {
      expect(await h.surface.remove(catalogThread().threadId)).toBe(true);
    });
    expect(h.read).toHaveBeenLastCalledWith(expect.objectContaining({ beforeThreadId: null }));
    expect(h.surface.rows.map((row) => row.threadId)).toEqual(["agt-3-0a1b"]);
  });

  it("drops the row and warns when history is gone but attachment cleanup failed", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.read.mockResolvedValueOnce({ threads: [], beforeThreadId: null, hasEarlier: false });
    h.deleteSavedThread.mockRejectedValueOnce(
      new AgentThreadCleanupIncompleteError(
        "The saved thread was deleted but its attachments could not be removed: EACCES",
      ),
    );
    await act(async () => {
      expect(await h.surface.remove(catalogThread().threadId)).toBe(true);
    });
    expect(h.surface.rows).toEqual([]);
    expect(h.surface.page?.error).toBeNull();
    expect(h.surface.page?.notice).toContain("attachments could not be removed");
  });

  it("marks the row as deleting instead of loading while the delete is pending", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    let finish!: () => void;
    h.deleteSavedThread.mockReturnValueOnce(
      new Promise<void>((done) => {
        finish = done;
      }),
    );
    let removing!: Promise<boolean>;
    act(() => {
      removing = h.surface.remove(catalogThread().threadId);
    });
    expect(h.surface.page?.deletingThreadId).toBe(catalogThread().threadId);
    expect(h.surface.page?.loading).toBe(false);
    await act(async () => {
      expect(await h.surface.open(catalogThread().threadId)).toBe(false);
      finish();
      await removing;
    });
    expect(h.surface.page?.deletingThreadId).toBeNull();
  });

  it("does not evict another thread to rename or archive, and says which action failed", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    for (let index = 0; index < MAX_AGENT_THREADS_PER_ROOT; index += 1) {
      const thread = catalogThread(`agt-${100 + index}-0a1b`);
      h.loaded.set(thread.threadId, thread);
    }
    await act(async () => {
      expect(await h.surface.rename(catalogThread().threadId, "New name")).toBe(false);
    });
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.surface.page?.error).toContain("Could not rename this conversation");
    await act(async () => {
      expect(await h.surface.setArchived(catalogThread().threadId, true)).toBe(false);
    });
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.surface.page?.error).toContain("Could not archive this conversation");
  });

  it("names the action when restoring for a rename fails", async () => {
    const h = setup();
    await act(() => h.surface.choose(catalogProject.rootKey));
    h.restore.mockResolvedValueOnce(false);
    await act(async () => {
      expect(await h.surface.rename(catalogThread().threadId, "New name")).toBe(false);
    });
    expect(h.surface.page?.error).toContain("Could not rename this conversation");
  });

  it("lists a conversation that is live for the page root with its live state", async () => {
    const h = setup();
    h.loaded.set(catalogThread().threadId, {
      ...catalogThread(),
      title: "Live title",
      turns: [runningTurnFixture],
    });
    await act(() => h.surface.choose(catalogProject.rootKey));
    expect(h.surface.rows).toEqual([
      expect.objectContaining({
        threadId: catalogThread().threadId,
        title: "Live title",
        archived: false,
        running: true,
      }),
    ]);
  });

  it("keeps a live archived conversation listed with its live title", async () => {
    const h = setup();
    h.loaded.set(catalogThread().threadId, {
      ...catalogThread(),
      archived: true,
      title: "Live title",
    });
    await act(() => h.surface.choose(catalogProject.rootKey));
    expect(h.surface.rows).toEqual([
      expect.objectContaining({
        threadId: catalogThread().threadId,
        title: "Live title",
        archived: true,
        running: false,
      }),
    ]);
  });

  it("does not mark a row running for a same-id thread that runs under another root", async () => {
    const h = setup();
    const foreign = catalogThread();
    h.loaded.set(foreign.threadId, {
      ...foreign,
      title: "Foreign title",
      archived: true,
      turns: [runningTurnFixture],
      owner: { ...foreign.owner, rootKey: "/workspace/other" },
    });
    await act(() => h.surface.choose(catalogProject.rootKey));
    expect(h.surface.rows).toEqual([
      expect.objectContaining({
        threadId: foreign.threadId,
        title: foreign.title,
        archived: false,
        running: false,
      }),
    ]);
  });
});
