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
      [h.id, { viewedAtEpochMs: expect.any(Number) }],
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
