// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentHistoryPager } from "./AgentHistoryPager";
import { AgentThreadSession } from "./AgentThreadSession";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { logTurn } from "../../test/agentTurnLogStoreHarness";
import type { AgentThreadHistorySurface } from "../../application/useAgentThreadHistory";

it("shows an isolated old page and returns to the unchanged newest turn", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const view = {
    ...original,
    thread: {
      ...original.thread,
      turnsTruncated: true,
      turns: [logTurn({ turnId: "latest", prompt: "Newest prompt" })],
    },
  };
  const history: AgentThreadHistorySurface = {
    page: {
      threadId: view.thread.threadId,
      turns: [logTurn({ turnId: "oldest", prompt: "Old saved prompt" })],
      hasEarlier: false,
      loading: false,
      error: null,
    },
    older: vi.fn(),
    latest: vi.fn(),
  };
  await act(async () =>
    root.render(
      <AgentThreadSession
        thread={view}
        history={history}
        composerRepositoryLabel="app"
        onReviewInDiff={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain("Old saved prompt");
  expect(host.textContent).not.toContain("Newest prompt");
  expect(host.textContent).not.toContain("Earlier turns were dropped");
  const latest = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Back to latest",
  )!;
  await act(async () => latest.click());
  expect(history.latest).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(
      <AgentThreadSession
        thread={view}
        history={{ ...history, page: null }}
        composerRepositoryLabel="app"
        onReviewInDiff={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain("Newest prompt");
  expect(host.textContent).not.toContain("Old saved prompt");
  await act(async () => root.unmount());
});

it("offers the latest activity again while a running turn shows saved activity", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const turn = logTurn({
    turnId: "live",
    status: { kind: "running" },
    events: [{ kind: "assistantText", text: "Current live output" }],
    eventsTruncated: true,
  });
  const view = { ...original, thread: { ...original.thread, turns: [turn] } };
  const readPage = vi.fn().mockResolvedValue({
    entries: [
      { seq: 1, event: { kind: "contextCompactionStatus", status: "compacting", message: null } },
    ],
    firstSeq: 1,
    lastSeq: 1,
    hasEarlier: false,
    hasLater: false,
    clipped: false,
    loss: { kind: "none" },
  });
  const history: AgentThreadHistorySurface = {
    page: null,
    older: vi.fn(),
    latest: vi.fn(),
    activitySource: () => ({
      scope: {
        rootKey: view.thread.owner.rootKey,
        ownerId: view.thread.owner.ownerId,
        threadId: view.thread.threadId,
        turnId: turn.turnId,
      },
      generation: 1,
      leaseToken: null,
      readPage,
    }),
  };
  try {
    await act(async () =>
      root.render(
        <AgentThreadSession
          thread={view}
          history={history}
          composerRepositoryLabel="app"
          onReviewInDiff={vi.fn()}
        />,
      ),
    );
    expect(readPage).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.click());
    expect(readPage).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("Compacting context…");
    expect(host.querySelectorAll(".agent-tool-row--working")).toHaveLength(1);
    const latest = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show latest activity",
    );
    expect(latest).toBeDefined();
    await act(async () => latest?.click());
    expect(host.textContent).toContain("Current live output");
    expect(turn.status.kind).toBe("running");
  } finally {
    act(() => root.unmount());
  }
});

it("keeps the latest activity reachable when a window opened during a run settles", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const running = logTurn({
    turnId: "live",
    status: { kind: "running" },
    events: [{ kind: "assistantText", text: "Current live output" }],
    eventsTruncated: true,
  });
  const settled = logTurn({
    ...running,
    status: { kind: "exited", exitCode: 0 },
    events: [
      { kind: "assistantText", text: "Current live output" },
      { kind: "assistantText", text: "Settled final answer" },
    ],
  });
  const viewOf = (turn: typeof running) => ({
    ...original,
    thread: { ...original.thread, turns: [turn] },
  });
  const readPage = vi.fn().mockResolvedValue({
    entries: [{ seq: 1, event: { kind: "assistantText", text: "Saved window entry" } }],
    firstSeq: 1,
    lastSeq: 1,
    hasEarlier: false,
    hasLater: false,
    clipped: false,
    loss: { kind: "none" },
  });
  const history: AgentThreadHistorySurface = {
    page: null,
    older: vi.fn(),
    latest: vi.fn(),
    activitySource: () => ({
      scope: {
        rootKey: original.thread.owner.rootKey,
        ownerId: original.thread.owner.ownerId,
        threadId: original.thread.threadId,
        turnId: running.turnId,
      },
      generation: 1,
      leaseToken: null,
      readPage,
    }),
  };
  const render = (turn: typeof running) =>
    act(async () =>
      root.render(
        <AgentThreadSession
          thread={viewOf(turn)}
          history={history}
          composerRepositoryLabel="app"
          onReviewInDiff={vi.fn()}
        />,
      ),
    );
  const latestButton = () =>
    [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show latest activity",
    );
  try {
    await render(running);
    await act(async () => host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.click());
    expect(host.textContent).toContain("Saved window entry");

    await render(settled);

    expect(latestButton()).toBeDefined();
    await act(async () => latestButton()?.click());
    expect(host.textContent).not.toContain("Saved window entry");
    expect(host.textContent).toContain("Settled final answer");
  } finally {
    act(() => root.unmount());
  }
});

it("loads earlier work only on request, keeps final prose once, and keeps page-ending updates and raw diagnostics", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const turn = logTurn({
    turnId: "saved",
    prompt: "Preserved prompt",
    eventsTruncated: true,
    status: { kind: "exited", exitCode: 0 },
    events: [{ kind: "assistantText", text: "Final answer stays visible" }],
  });
  const readPage = vi.fn().mockResolvedValueOnce({
    entries: [
      { seq: 1, event: { kind: "reasoning", text: "Earlier reasoning" } },
      { seq: 2, event: { kind: "error", message: "An earlier failure" } },
      {
        seq: 3,
        event: {
          kind: "unknownLine",
          stream: "stderr",
          raw: "Historical diagnostic",
          clipped: false,
        },
      },
      { seq: 4, event: { kind: "assistantText", text: "Intermediate page-ending update" } },
    ],
    firstSeq: 1,
    lastSeq: 4,
    hasEarlier: false,
    hasLater: true,
    clipped: false,
    loss: { kind: "none" },
  });
  const history: AgentThreadHistorySurface = {
    page: null,
    older: vi.fn(),
    latest: vi.fn(),
    activitySource: () => ({
      scope: {
        rootKey: "/workspace",
        ownerId: "owner",
        threadId: original.thread.threadId,
        turnId: turn.turnId,
      },
      generation: 1,
      leaseToken: null,
      readPage,
    }),
  };
  try {
    await act(async () =>
      root.render(
        <AgentThreadSession
          thread={{ ...original, thread: { ...original.thread, turns: [turn] } }}
          history={history}
          composerRepositoryLabel="app"
          onReviewInDiff={vi.fn()}
        />,
      ),
    );
    expect(readPage).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.click());
    expect(readPage).toHaveBeenCalledOnce();
    const work = host.querySelector<HTMLDetailsElement>(".agent-work");
    expect(work?.open).toBe(true);
    expect(work?.textContent).toContain("Intermediate page-ending update");
    expect(work?.textContent).toContain("Historical diagnostic");
    expect(host.textContent).toContain("Preserved prompt");
    expect(host.textContent?.match(/Final answer stays visible/g)).toHaveLength(1);
    readPage.mockResolvedValueOnce({
      entries: [{ seq: 10, event: turn.events[0] }],
      firstSeq: 10,
      lastSeq: 10,
      hasEarlier: true,
      hasLater: false,
      clipped: false,
      loss: { kind: "none" },
    });
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Show later activity")
        ?.click(),
    );
    expect(host.textContent?.match(/Final answer stays visible/g)).toHaveLength(1);
    expect(host.textContent).toContain("Some activity is missing from the saved history.");
    expect(host.querySelector<HTMLDetailsElement>(".agent-work")?.open).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});

it("does not add a control or request history merely because a reader exists", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const turn = logTurn({ events: [], eventsTruncated: false });
  const readPage = vi.fn();
  try {
    await act(async () =>
      root.render(
        <AgentThreadSession
          thread={{ ...original, thread: { ...original.thread, turns: [turn] } }}
          history={{
            page: null,
            older: vi.fn(),
            latest: vi.fn(),
            activitySource: () => ({
              scope: {
                rootKey: "/root",
                ownerId: "owner",
                threadId: original.thread.threadId,
                turnId: turn.turnId,
              },
              generation: 1,
              leaseToken: null,
              readPage,
            }),
          }}
          composerRepositoryLabel="app"
          onReviewInDiff={vi.fn()}
        />,
      ),
    );
    expect(host.querySelector(".agent-work")).toBeNull();
    expect(host.querySelector("button.cv-load-earlier")).toBeNull();
    expect(readPage).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});

it("offers earlier turns as one quiet button whose label is the loading state", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onEarlier = vi.fn();
  act(() =>
    root.render(
      <AgentHistoryPager hasEarlier onEarlier={onEarlier} onLatest={() => undefined} page={null} />,
    ),
  );
  const button = host.querySelector<HTMLButtonElement>("button.cv-load-earlier");
  expect(button?.textContent).toBe("Load earlier turns");
  act(() => button?.click());
  expect(onEarlier).toHaveBeenCalledTimes(1);

  act(() =>
    root.render(
      <AgentHistoryPager
        hasEarlier
        onEarlier={onEarlier}
        onLatest={() => undefined}
        page={{ threadId: "t", turns: [], hasEarlier: true, loading: true, error: null }}
      />,
    ),
  );
  expect(host.querySelector("button.cv-load-earlier")?.textContent).toBe("Loading earlier turns…");
  expect(host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.disabled).toBe(true);
  act(() => root.unmount());
  host.remove();
});
