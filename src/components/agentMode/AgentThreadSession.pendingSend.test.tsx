// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentPendingSend } from "./agentPendingSend";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { AgentThreadSession } from "./AgentThreadSession";

const send: AgentPendingSend = {
  id: 1,
  target: { kind: "followUp", threadId: "agt-1", baseTurnId: "t1" },
  prompt: "Next step",
  attachments: [],
  sentAtEpochMs: 1_700_000_000_000,
  status: "sending",
};

describe("AgentThreadSession pending send", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("appends exactly one optimistic message after the recorded turns", () => {
    const base = surfaceThreadView();
    const view = surfaceThreadView({
      thread: {
        ...base.thread,
        turns: [
          {
            turnId: "t1",
            prompt: "First step",
            status: { kind: "exited", exitCode: 0 },
            startedAtEpochMs: 1,
            endedAtEpochMs: 2,
            events: [],
            eventsTruncated: false,
            lastStatusSequence: 0,
            lastOutputSequence: 0,
            launch: null,
            cliVersion: null,
          },
        ],
      },
    });
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          onReviewInDiff={() => undefined}
          pendingSend={send}
          thread={view}
        />,
      ),
    );
    const turns = [...host.querySelectorAll(".agent-turn-list > .agent-turn")];
    expect(turns).toHaveLength(2);
    expect(turns[1]?.getAttribute("data-pending-send")).toBe("sending");
    expect(turns[1]?.querySelector(".agent-prompt__body")?.textContent).toBe("Next step");
  });

  it("shows a new thread's first message instead of the empty hero", () => {
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          onReviewInDiff={() => undefined}
          pendingSend={{ ...send, target: { kind: "new", projectRootKey: "/workspace/app" } }}
          thread={null}
        />,
      ),
    );
    expect(host.querySelector(".cv-empty-hero")).toBeNull();
    expect(host.querySelectorAll("[data-pending-send]")).toHaveLength(1);
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          onReviewInDiff={() => undefined}
          pendingSend={null}
          thread={null}
        />,
      ),
    );
    expect(host.querySelector(".cv-empty-hero")).not.toBeNull();
  });
});
