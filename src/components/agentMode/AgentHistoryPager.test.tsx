// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
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

it("does not present an old compaction page as live execution", async () => {
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
      readPage: async () => ({
        entries: [
          {
            seq: 1,
            event: { kind: "contextCompactionStatus", status: "compacting", message: null },
          },
        ],
        firstSeq: 1,
        lastSeq: 1,
        hasEarlier: false,
        hasLater: true,
        clipped: false,
        loss: { kind: "none" },
      }),
    }),
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
  const work = host.querySelector<HTMLDetailsElement>(".agent-work")!;
  await act(async () => {
    work.open = false;
    work.querySelector("summary")!.click();
  });
  expect(host.textContent).toContain("Current live output");
  expect(host.textContent).toContain("Viewing a page of saved activity");
  expect(host.textContent).not.toContain("Compacting context…");
  expect(host.querySelectorAll(".agent-tool-row--working")).toHaveLength(1);
  expect(turn.status.kind).toBe("running");
  await act(async () => root.unmount());
});

it("loads missing work only on expansion, keeps final prose, and retains page-ending updates and raw diagnostics", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const turn = logTurn({
    turnId: "saved",
    prompt: "Preserved prompt",
    eventsTruncated: true,
    firstEventOffset: 9,
    status: { kind: "exited", exitCode: 0 },
    events: [{ kind: "assistantText", text: "Final answer stays visible" }],
  });
  const readPage = vi.fn().mockResolvedValue({
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
    expect(host.textContent).not.toContain("Saved activity");
    const work = host.querySelector<HTMLDetailsElement>(".agent-work")!;
    await act(async () => work.querySelector("summary")!.click());
    expect(readPage).toHaveBeenCalledOnce();
    expect(work.textContent).toContain("Intermediate page-ending update");
    expect(work.textContent).toContain("Historical diagnostic");
    expect(host.querySelectorAll(".agent-prompt")).toHaveLength(1);
    expect(host.textContent).toContain("Preserved prompt");
    expect(host.textContent?.match(/Final answer stays visible/g)).toHaveLength(1);
    readPage.mockResolvedValue({
      entries: [{ seq: 10, event: turn.events[0] }],
      firstSeq: 10,
      lastSeq: 10,
      hasEarlier: true,
      hasLater: false,
      clipped: false,
      loss: { kind: "none" },
    });
    await act(async () =>
      Array.from(work.querySelectorAll("button"))
        .find((b) => b.textContent === "Newer activity")!
        .click(),
    );
    expect(host.textContent?.match(/Final answer stays visible/g)).toHaveLength(1);
    expect(work.open).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});

it("does not add an empty disclosure or request history merely because a reader exists", async () => {
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
    expect(readPage).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Saved activity");
  } finally {
    act(() => root.unmount());
  }
});
