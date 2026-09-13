// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRemoteAgentMetadata, type RemoteAgentMetadataRepository } from "./remoteAgentMetadata";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import { BrowserRemoteAgentMetadataRepository } from "../infrastructure/browserRemoteAgentMetadataRepository";
const view = projectRemoteAgentThreads({
  serverId: "s",
  runnerId: "r",
  projects: [{ id: "p", name: "Project" }],
  tasks: [
    {
      id: "t",
      runnerId: "r",
      projectId: "p",
      sequence: 1,
      provider: "codex",
      status: "succeeded",
      parts: [{ type: "text", text: "Original" }],
      createdAt: "2026-09-13T00:00:00Z",
    },
  ],
  replays: new Map(),
  resumes: new Map(),
})[0]!;
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
async function render(repository: RemoteAgentMetadataRepository) {
  const root = createRoot(document.createElement("div"));
  let surface!: ReturnType<typeof useRemoteAgentMetadata>;
  function Harness() {
    surface = useRemoteAgentMetadata(repository);
    return null;
  }
  await act(async () => {
    root.render(createElement(Harness));
  });
  disposers.push(() => act(() => root.unmount()));
  return () => surface;
}
describe("remote presentation metadata", () => {
  it("does not save initial load or overwrite unreadable storage", async () => {
    const repository = {
      load: vi.fn(() => {
        throw new Error("unreadable");
      }),
      save: vi.fn(),
    };
    const current = await render(repository);
    expect(repository.save).not.toHaveBeenCalled();
    expect(current().project(view)).toEqual(view);
  });
  it("keeps pin/archive/remove in memory when persistence throws", async () => {
    const current = await render({
      load: () => [],
      save: () => {
        throw new Error("quota");
      },
    });
    await act(async () => {
      current().update(view.thread.threadId, { pinned: true });
    });
    expect(current().project(view)?.thread.pinned).toBe(true);
    expect(current().persistenceError).toContain("could not be saved");
    await act(async () => {
      current().update(view.thread.threadId, { archived: true });
    });
    expect(current().project(view)?.lifecycle).toBe("archived");
    await act(async () => {
      current().update(view.thread.threadId, { removed: true });
    });
    expect(current().project(view)).toBeNull();
  });
  it("normalizes long emoji and multiline rename before saving through the real adapter", async () => {
    let saved: string | null = null;
    const repository = new BrowserRemoteAgentMetadataRepository(() => ({
      getItem: () => saved,
      setItem: (_key, value) => {
        saved = value;
      },
    }));
    const current = await render(repository);
    await act(async () => {
      current().update(view.thread.threadId, { title: "😀".repeat(200) + "\nsecond line" });
    });
    const title = repository.load()[0]?.title;
    expect(title).toBe(current().project(view)?.thread.title);
    expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(256);
    expect(title).not.toContain("\n");
    expect(current().persistenceError).toBeNull();
    await act(async () => {
      current().update(view.thread.threadId, { title: "\n first title \nsecond title" });
    });
    expect(repository.load()[0]?.title).toBe("first title");
  });
  it("rejects blank and control-bearing titles without persisting them", async () => {
    const repository = { load: () => [], save: vi.fn() };
    const current = await render(repository);
    await act(async () => {
      current().update(view.thread.threadId, { title: "  " });
      current().update(view.thread.threadId, { title: "bad\u0000title" });
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(current().project(view)?.thread.title).toBe(view.thread.title);
  });
  it("saves user flags and clears the persistence notice after a successful retry", async () => {
    const save = vi.fn().mockImplementationOnce(() => {
      throw new Error("quota");
    });
    const current = await render({ load: () => [], save });
    await act(async () => {
      current().update(view.thread.threadId, { pinned: true });
    });
    await act(async () => {
      current().update(view.thread.threadId, { pinned: false, viewedAtEpochMs: 123 });
    });
    expect(current().persistenceError).toBeNull();
    expect(save).toHaveBeenLastCalledWith([
      { threadId: view.thread.threadId, pinned: false, viewedAtEpochMs: 123 },
    ]);
  });
});
