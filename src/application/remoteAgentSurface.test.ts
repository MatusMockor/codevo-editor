import { describe, expect, it, vi } from "vitest";
import { surfaceChangedFile } from "../components/agentMode/agentSurfaceTestFixtures";
import { threadsSurfaceFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import { remoteAgentThreadActions } from "./remoteAgentSurface";
function setup(running = false) {
  const threads = projectRemoteAgentThreads({
    serverId: "server",
    runnerId: "runner",
    projects: [{ id: "project", name: "App" }],
    tasks: [
      {
        id: "root",
        runnerId: "runner",
        sequence: 1,
        provider: "codex",
        status: running ? "running" : "succeeded",
        projectId: "project",
        parts: [],
        createdAt: "2026-09-13T00:00:00Z",
      },
    ],
    replays: new Map(),
    resumes: new Map(),
  });
  const local = threadsSurfaceFixture({
    renameThread: vi.fn(),
    updateThreadOrganization: vi.fn(),
    reorderThread: vi.fn(),
    togglePin: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
    stop: vi.fn(),
    markThreadViewed: vi.fn(),
    markThreadUnread: vi.fn(),
    releaseProjectTasks: vi.fn(),
    stopProjectTasks: vi.fn(),
    removeWorktree: vi.fn(),
    commitThreadChanges: vi.fn(),
    pushThreadBranch: vi.fn(),
    openThreadCompareUrl: vi.fn(),
    integrateThreadBranch: vi.fn(),
    showFileDiff: vi.fn(),
  });
  const update = vi.fn();
  const report = vi.fn();
  const stop = vi.fn();
  return {
    local,
    update,
    report,
    stop,
    id: threads[0]!.thread.threadId,
    view: threads[0]!,
    owner: threads[0]!.thread.owner.ownerId,
    actions: remoteAgentThreadActions({ local, threads, update, report, stop }),
  };
}
describe("remote conversation action routing", () => {
  it("stores presentation preferences without entering local thread persistence", () => {
    const h = setup();
    h.actions.renameThread(h.id, "Remote title");
    h.actions.togglePin(h.id);
    h.actions.archive(h.id);
    h.actions.markThreadViewed(h.id);
    h.actions.markThreadUnread(h.id);
    h.actions.remove(h.id);
    expect(h.update.mock.calls).toEqual([
      [h.id, { title: "Remote title" }],
      [h.id, { pinned: true }],
      [h.id, { archived: true }],
      [h.id, { viewedAtEpochMs: Date.parse("2026-09-13T00:00:00Z") + 1 }],
      [h.id, { viewedAtEpochMs: null }],
      [h.id, { removed: true }],
    ]);
    for (const action of [
      h.local.renameThread,
      h.local.togglePin,
      h.local.archive,
      h.local.markThreadViewed,
      h.local.markThreadUnread,
      h.local.remove,
    ])
      expect(action).not.toHaveBeenCalled();
    expect(h.actions.threadCopyDetail(h.id, "threadId")).toBe("root");
  });
  it("routes organization locally or remotely without crossing environments", () => {
    const h = setup();
    h.actions.updateThreadOrganization(h.id, { snoozedUntil: 5000 });
    h.actions.updateThreadOrganization("local", { settledAt: 4000 });
    h.actions.reorderThread("local", h.id, "before");
    expect(h.update).toHaveBeenCalledWith(h.id, { snoozedUntil: 5000 });
    expect(h.local.updateThreadOrganization).toHaveBeenCalledWith("local", { settledAt: 4000 });
    expect(h.local.reorderThread).not.toHaveBeenCalled();
    const running = setup(true);
    running.actions.updateThreadOrganization(running.id, { settledAt: 4000 });
    expect(running.update).not.toHaveBeenCalled();
    expect(running.report).toHaveBeenCalled();
  });
  it("marks viewed with the server activity time, not the local clock", () => {
    const h = setup();
    const now = vi.spyOn(Date, "now").mockReturnValue(9_999_999_999_999);
    h.actions.markThreadViewed(h.id);
    now.mockRestore();
    expect(h.update).toHaveBeenCalledWith(h.id, {
      viewedAtEpochMs: Date.parse("2026-09-13T00:00:00Z") + 1,
    });
  });
  it("archives and unarchives explicitly and resolves with the server save outcome", async () => {
    const h = setup();
    h.update.mockResolvedValueOnce(true);
    await expect(h.actions.archive(h.id)).resolves.toBe(true);
    await expect(h.actions.unarchive(h.id)).resolves.toBe(false);
    expect(h.update.mock.calls).toEqual([[h.id, { archived: true }]]);
    const archived = remoteAgentThreadActions({
      local: h.local,
      threads: [{ ...h.view, thread: { ...h.view.thread, archived: true } }],
      update: h.update,
      report: h.report,
      stop: h.stop,
    });
    h.update.mockResolvedValueOnce(false);
    await expect(archived.archive(h.id)).resolves.toBe(false);
    await expect(archived.unarchive(h.id)).resolves.toBe(false);
    expect(h.update.mock.calls).toEqual([
      [h.id, { archived: true }],
      [h.id, { archived: false }],
    ]);
  });
  it("runs bulk work inside the metadata batch when one is wired and directly otherwise", async () => {
    const h = setup();
    await expect(h.actions.batchThreadMutations(async () => "direct")).resolves.toBe("direct");
    let batches = 0;
    const batch = <T>(work: () => Promise<T>): Promise<T> => {
      batches += 1;
      return work();
    };
    const batched = remoteAgentThreadActions({
      local: h.local,
      threads: [h.view],
      update: h.update,
      report: h.report,
      stop: h.stop,
      batch,
    });
    await expect(batched.batchThreadMutations(async () => 7)).resolves.toBe(7);
    expect(batches).toBe(1);
  });
  it("does not archive or remove a running conversation", () => {
    const h = setup(true);
    h.actions.archive(h.id);
    h.actions.remove(h.id);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledTimes(2);
  });
  it("stops remote owner tasks only through their exact remote thread and never releases a local owner", async () => {
    const h = setup(true);
    expect(h.actions.hasLiveTasksForOwner(h.owner)).toBe(true);
    await h.actions.stopProjectTasks(h.owner, []);
    h.actions.releaseProjectTasks(h.owner);
    expect(h.stop).toHaveBeenCalledWith(h.id);
    expect(h.local.stopProjectTasks).not.toHaveBeenCalled();
    expect(h.local.releaseProjectTasks).not.toHaveBeenCalled();
  });
  it("blocks local worktree, Git, and diff actions for unknown remote identities too", async () => {
    const h = setup();
    const unknown = "remote-thread:offline-conversation";
    await h.actions.removeWorktree(unknown);
    await h.actions.commitThreadChanges(unknown, "Message");
    await h.actions.pushThreadBranch(unknown);
    await h.actions.openThreadCompareUrl(unknown);
    await h.actions.integrateThreadBranch(unknown, "merge");
    await h.actions.showFileDiff(unknown, surfaceChangedFile("src/file.ts"));
    for (const action of [
      h.local.removeWorktree,
      h.local.commitThreadChanges,
      h.local.pushThreadBranch,
      h.local.openThreadCompareUrl,
      h.local.integrateThreadBranch,
      h.local.showFileDiff,
    ])
      expect(action).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledTimes(6);
  });
  it("preserves original local actions and their exact arguments", async () => {
    const h = setup();
    h.actions.renameThread("local", "Name");
    h.actions.archive("local");
    await h.actions.stop("local");
    await h.actions.showFileDiff("local", surfaceChangedFile("src/file.ts"));
    expect(h.local.renameThread).toHaveBeenCalledWith("local", "Name");
    expect(h.local.archive).toHaveBeenCalledWith("local");
    expect(h.local.stop).toHaveBeenCalledWith("local");
    expect(h.local.showFileDiff).toHaveBeenCalledWith("local", surfaceChangedFile("src/file.ts"));
    expect(h.update).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });
});
