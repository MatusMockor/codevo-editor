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
  const saved = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Saved activity",
  )!;
  await act(async () => saved.click());
  expect(host.textContent).toContain("Viewing a page of saved activity");
  expect(host.textContent).not.toContain("Compacting context…");
  expect(host.querySelector(".agent-tool-row--working")).toBeNull();
  expect(turn.status.kind).toBe("running");
  await act(async () => root.unmount());
});
