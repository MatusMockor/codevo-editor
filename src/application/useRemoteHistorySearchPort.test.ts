// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { AgentHistorySearchPort } from "./agentThreadPorts";
import { useRemoteHistorySearchPort } from "./useRemoteHistorySearchPort";
import { describe, expect, it, vi } from "vitest";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import { searchRemoteHistory, REMOTE_HISTORY_SEARCH_MAX_PAGES } from "./useRemoteHistorySearchPort";
import type { RemoteRunnerHistorySearchPage, RemoteRunnerServer } from "../domain/remoteRunner";
const server: RemoteRunnerServer = {
  id: "server",
  name: "Server",
  host: "host",
  username: "user",
  port: 22,
  connected: true,
};
const views = projectRemoteAgentThreads({
  serverId: "server",
  runnerId: "runner",
  projects: [{ id: "project", name: "Project" }],
  tasks: [
    {
      id: "task",
      runnerId: "runner",
      conversationId: "task",
      sequence: 1,
      projectId: "project",
      provider: "claude",
      status: "succeeded",
      parts: [{ type: "text", text: "Unrelated prompt" }],
      createdAt: "2026-09-15T00:00:00Z",
    },
  ],
  replays: new Map(),
  resumes: new Map(),
});
const ids = new Set(views.map((view) => view.thread.threadId));
const page = (
  overrides: Partial<RemoteRunnerHistorySearchPage> = {},
): RemoteRunnerHistorySearchPage => ({
  items: [],
  nextCursor: null,
  scope: "retained_runner_history",
  incomplete: false,
  ...overrides,
});
const hit = {
  taskId: "task",
  conversationId: "task",
  projectId: "project",
  taskSequence: 1,
  role: "assistant" as const,
  eventSequence: 900,
  snippet: "An older needle response",
};
describe("persisted remote history search", () => {
  it("continues empty cursor pages and maps hits absent from loaded replay without using raw event offset", async () => {
    const searchHistory = vi
      .fn()
      .mockResolvedValueOnce(page({ nextCursor: 10 }))
      .mockResolvedValueOnce(page({ items: [hit] }));
    const result = await searchRemoteHistory(
      { searchHistory },
      [server],
      views,
      "needle",
      ids,
      () => true,
    );
    expect(searchHistory).toHaveBeenLastCalledWith({
      serverId: "server",
      query: "needle",
      after: 10,
    });
    expect(result.matches[0]).toMatchObject({
      turnId: "task",
      eventIndex: null,
      resolveQuery: true,
      resolveSource: "assistant",
    });
    expect(result.documentsTruncated).toBe(false);
  });
  it("marks unknown history, disconnected servers, and server retention gaps incomplete", async () => {
    const searchHistory = vi
      .fn()
      .mockResolvedValue(page({ items: [{ ...hit, taskId: "unknown" }], incomplete: true }));
    expect(
      (await searchRemoteHistory({ searchHistory }, [server], views, "needle", ids, () => true))
        .documentsTruncated,
    ).toBe(true);
    searchHistory.mockClear();
    expect(
      (
        await searchRemoteHistory(
          { searchHistory },
          [{ ...server, connected: false }],
          views,
          "needle",
          ids,
          () => true,
        )
      ).documentsTruncated,
    ).toBe(true);
    expect(searchHistory).not.toHaveBeenCalled();
  });
  it("bounds sparse pagination and declares remaining history incomplete", async () => {
    const searchHistory = vi.fn(async ({ after = 0 }: { after?: number }) =>
      page({ nextCursor: after + 10 }),
    );
    const result = await searchRemoteHistory(
      { searchHistory },
      [server],
      views,
      "needle",
      ids,
      () => true,
    );
    expect(searchHistory).toHaveBeenCalledTimes(REMOTE_HISTORY_SEARCH_MAX_PAGES);
    expect(result.documentsTruncated).toBe(true);
  });
  it("rejects revoked authority immediately after an awaited response", async () => {
    let valid = true;
    const searchHistory = vi.fn(async () => {
      valid = false;
      return page({ items: [hit] });
    });
    await expect(
      searchRemoteHistory({ searchHistory }, [server], views, "needle", ids, () => valid),
    ).rejects.toThrow("cancelled");
  });
});

it("refreshes terminal revisions and revokes disconnected/unmounted owners", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const searchHistory = vi.fn(async () => page());
  const gateway = { searchHistory };
  const root = createRoot(document.createElement("div"));
  let current: AgentHistorySearchPort | null = null;
  let entries = views;
  let servers = [server];
  function Harness() {
    current = useRemoteHistorySearchPort({
      gateway,
      servers,
      workspaceOwner: "workspace",
      views: entries,
    });
    return null;
  }
  act(() => root.render(createElement(Harness)));
  const first = current!;
  entries = views.map((view) => ({
    ...view,
    thread: {
      ...view.thread,
      turns: view.thread.turns.map((turn) => ({ ...turn, status: { kind: "running" as const } })),
    },
  }));
  act(() => root.render(createElement(Harness)));
  expect(current).not.toBe(first);
  const running = current!;
  entries = views;
  act(() => root.render(createElement(Harness)));
  expect(current).not.toBe(running);
  expect(current).not.toBe(first);
  await expect(first.search("needle", ids, new AbortController().signal)).rejects.toThrow(
    "cancelled",
  );
  const connected = current!;
  servers = [{ ...server, connected: false }];
  act(() => root.render(createElement(Harness)));
  await expect(connected.search("needle", ids, new AbortController().signal)).rejects.toThrow(
    "cancelled",
  );
  const disconnected = current!;
  expect(
    (await disconnected.search("needle", ids, new AbortController().signal)).documentsTruncated,
  ).toBe(true);
  act(() => root.unmount());
  await expect(disconnected.search("needle", ids, new AbortController().signal)).rejects.toThrow(
    "cancelled",
  );
});
it("reaches the last task of 1000 retained tasks through empty pages", async () => {
  const searchHistory = vi.fn(async ({ after = 0 }: { after?: number }) =>
    after === 990 ? page({ items: [hit] }) : page({ nextCursor: after + 10 }),
  );
  const result = await searchRemoteHistory(
    { searchHistory },
    [server],
    views,
    "needle",
    ids,
    () => true,
  );
  expect(searchHistory).toHaveBeenCalledTimes(100);
  expect(result.matches).toHaveLength(1);
  expect(result.documentsTruncated).toBe(false);
});
it("omits ambiguous Unicode-expanded offsets instead of highlighting a different word", async () => {
  const searchHistory = vi.fn(async () => page({ items: [{ ...hit, snippet: "İ needle" }] }));
  const result = await searchRemoteHistory(
    { searchHistory },
    [server],
    views,
    "needle",
    ids,
    () => true,
  );
  expect(result.matches[0]!.ranges).toEqual([]);
});
