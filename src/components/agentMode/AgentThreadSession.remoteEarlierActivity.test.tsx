// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyRemoteInventory,
  type RemoteAgentInventorySnapshot,
} from "../../application/remoteAgentInventoryLoad";
import { projectRemoteAgentThreads } from "../../application/remoteAgentProjection";
import {
  FakeRunnerEvents,
  claudeTextLine,
} from "../../application/remoteAgentTurnActivityTestSupport";
import { useRemoteAgentThreadHistory } from "../../application/useRemoteAgentThreadHistory";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../../domain/remoteRunner";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentThreadSession } from "./AgentThreadSession";
import {
  AGENT_TURN_REMOTE_DISCARDED_NOTICE,
  AGENT_TURN_REMOTE_WINDOW_NOTICE,
} from "./agentTurnLogNotice";

const TASK: RemoteRunnerTask = {
  id: "task-1",
  runnerId: "runner",
  sequence: 1,
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [{ type: "text", text: "Refactor the parser" }],
  createdAt: "2026-09-13T00:00:00Z",
  conversationId: "task-1",
};
const STEPS = 250;
const RETAINED_STEPS = 20;
const EVENTS_PER_STEP = 3;

interface Scenario {
  readonly capability: boolean;
  readonly serverDiscardedThrough?: number;
  readonly retention: "clientWindow" | "serverGap";
}

function label(index: number): string {
  return `step ${String(index).padStart(4, "0")}.`;
}

function stepLines(index: number): ReadonlyArray<string> {
  const id = `toolu_${index}`;
  const input = { command: `echo ${index}` };
  return [
    claudeTextLine(label(index)),
    `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input }] } })}\n`,
    `${JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } })}\n`,
  ];
}

describe("remote turn earlier activity", () => {
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

  function mount(scenario: Scenario) {
    const runner = new FakeRunnerEvents();
    for (let index = 0; index < STEPS; index += 1)
      for (const line of stepLines(index)) runner.output(TASK.id, line);
    runner.output(TASK.id, claudeTextLine("All done."));
    runner.lifecycle(TASK.id, "task.succeeded");
    const all = runner.eventsOf(TASK.id);
    const tail = all.slice(-RETAINED_STEPS * EVENTS_PER_STEP - 2);
    if (scenario.serverDiscardedThrough !== undefined)
      runner.discardOutputThrough(
        TASK.id,
        all[(scenario.serverDiscardedThrough + 1) * EVENTS_PER_STEP - 1]!.sequence,
        true,
      );
    const snapshot: RemoteAgentInventorySnapshot = {
      ...emptyRemoteInventory("server", true),
      descriptor: {
        protocolVersion: 1,
        runnerId: "runner",
        name: "Server",
        capabilities: {
          taskExecution: true,
          eventReplay: true,
          ...(scenario.capability ? { eventBackwardPaging: true } : {}),
        },
      },
      tasks: [TASK],
      replays: new Map([[TASK.id, tail]]),
      replayComplete: new Set([TASK.id]),
      replayTruncated: new Set([TASK.id]),
      replayDiscarded: new Set(scenario.retention === "serverGap" ? [TASK.id] : []),
      replayGaps: new Map([
        [TASK.id, { throughSequence: tail[0]!.sequence - 1, startsAtLineBoundary: true }],
      ]),
    };
    const views = projectRemoteAgentThreads({ ...snapshot, runnerId: "runner" });
    const gateway = { listEventsBefore: runner.listEventsBefore } as unknown as RemoteRunnerGateway;
    const owner = {};
    function Harness() {
      const history = useRemoteAgentThreadHistory({
        gateway,
        snapshots: [snapshot],
        views,
        selectedThreadId: views[0]!.thread.threadId,
        owner,
      });
      return (
        <AgentThreadSession
          thread={views[0]!}
          composerRepositoryLabel="app"
          history={history}
          onReviewInDiff={() => {}}
          turnLog={null}
        />
      );
    }
    act(() => root.render(<Harness />));
    return { runner, turn: views[0]!.thread.turns[0]! };
  }

  function loadButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>("button.cv-load-earlier");
  }

  async function loadEarlier(): Promise<void> {
    await act(async () => loadButton()?.click());
    await waitForReact(() => {
      expect(loadButton()?.textContent ?? "").not.toBe("Loading earlier activity…");
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });
  }

  async function loadEverything(): Promise<number> {
    let clicks = 0;
    while (loadButton()?.textContent === "Load earlier activity" && clicks < 20) {
      await loadEarlier();
      clicks += 1;
    }
    return clicks;
  }

  it("pages the earlier activity of a client-window turn from the runner instead of warning", async () => {
    const { runner, turn } = mount({ capability: true, retention: "clientWindow" });

    expect(turn.eventsTruncated).toBe(true);
    expect(turn.eventsRetention).toBe("clientWindow");
    expect(loadButton()?.textContent).toBe("Load earlier activity");
    expect(host.textContent).not.toContain(AGENT_TURN_REMOTE_WINDOW_NOTICE);
    expect(host.textContent).not.toContain(label(STEPS - RETAINED_STEPS - 1));
    expect(runner.calls).toEqual([]);

    await loadEarlier();

    expect(host.textContent).toContain(label(STEPS - RETAINED_STEPS - 1));
    expect(host.textContent).toContain(label(STEPS - 1));
    expect(host.textContent).not.toContain(label(0));
    expect(loadButton()?.textContent).toBe("Load earlier activity");
    expect(runner.calls.length).toBeGreaterThan(0);

    const clicks = await loadEverything();

    expect(clicks).toBeGreaterThan(0);
    expect(loadButton()).toBeNull();
    for (let index = 0; index < STEPS; index += 1) expect(host.textContent).toContain(label(index));
    expect(host.textContent?.split(label(7))).toHaveLength(2);
    expect(host.textContent).toContain("All done.");
    expect(host.querySelector(".agent-note--warning")).toBeNull();
    expect(host.textContent).not.toContain(AGENT_TURN_REMOTE_WINDOW_NOTICE);
  });

  it("keeps today's dead-end notice when the runner cannot page backwards", () => {
    const { runner } = mount({ capability: false, retention: "clientWindow" });

    expect(host.textContent).toContain(AGENT_TURN_REMOTE_WINDOW_NOTICE);
    expect(loadButton()).toBeNull();
    expect(runner.calls).toEqual([]);
  });

  it("stays truthful about output the server discarded while paging what is left", async () => {
    mount({ capability: true, retention: "serverGap", serverDiscardedThrough: 99 });

    expect(host.textContent).toContain(AGENT_TURN_REMOTE_DISCARDED_NOTICE);
    expect(loadButton()?.textContent).toBe("Load earlier activity");

    await loadEarlier();
    await loadEverything();

    expect(loadButton()).toBeNull();
    expect(host.textContent).toContain(label(100));
    expect(host.textContent).not.toContain(label(99));
    expect(host.querySelector(".cv-earlier .agent-note--warning")?.textContent).toBe(
      AGENT_TURN_REMOTE_DISCARDED_NOTICE,
    );
    expect(host.textContent?.split(AGENT_TURN_REMOTE_DISCARDED_NOTICE)).toHaveLength(2);
  });

  it("reports a discard the client had not noticed once paging reaches it", async () => {
    mount({ capability: true, retention: "clientWindow", serverDiscardedThrough: 99 });

    expect(host.querySelector(".agent-note--warning")).toBeNull();

    await loadEarlier();
    await loadEverything();

    expect(host.textContent).toContain(label(100));
    expect(host.querySelector(".cv-earlier .agent-note--warning")?.textContent).toBe(
      AGENT_TURN_REMOTE_DISCARDED_NOTICE,
    );
  });
});
