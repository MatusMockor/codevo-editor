// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import { projectRemoteAgentThreads } from "../../application/remoteAgentProjection";
import {
  remoteRunnerDisconnected,
  REMOTE_RUNNER_REACHABLE,
  REMOTE_RUNNER_RECONNECTING,
  type RemoteRunnerReachability,
} from "../../domain/remoteRunnerReachability";
import { FakeRunnerHost, fakeRunnerFleetGateway } from "../../test/remoteRunnerOutageTestSupport";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentAgentsPanelProvider } from "./agents/agentAgentsPanelContext";
import { AgentClockProvider } from "./agentClock";
import { AgentThreadRow } from "./AgentThreadRow";
import { AgentThreadSession } from "./AgentThreadSession";

const NOW = Date.parse("2026-09-13T00:00:10Z");

describe("a running remote turn while its server is not reachable", () => {
  let host: HTMLDivElement;
  let root: Root;
  let linux: FakeRunnerHost;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    linux = new FakeRunnerHost({ id: "linux", name: "Linux" });
    linux.runCommand("npm test");
    linux.output("Still checking the suite");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function threadView(reachability: RemoteRunnerReachability): AgentThreadView {
    const [view] = projectRemoteAgentThreads({
      serverId: "linux",
      runnerId: linux.runnerId,
      projects: [{ id: "project", name: "App" }],
      tasks: linux.tasks,
      replays: new Map([["first", linux.eventsAfter(0)]]),
      resumes: new Map(),
      reachability,
    });
    expect(view).toBeDefined();
    return view!;
  }

  async function renderSession(reachability: RemoteRunnerReachability): Promise<void> {
    const fleet = fakeRunnerFleetGateway([linux]);
    await act(async () => {
      root.render(
        <RemoteRunnerProvider gateway={fleet.gateway}>
          <AgentThreadSession
            composerRepositoryLabel="app"
            onReviewInDiff={() => undefined}
            thread={threadView(reachability)}
          />
        </RemoteRunnerProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
  }

  async function renderRow(reachability: RemoteRunnerReachability): Promise<void> {
    await act(async () => {
      root.render(
        <AgentClockProvider>
          <ul role="listbox">
            <AgentThreadRow
              focused={false}
              jumpLabel={null}
              on={false}
              onMenuCommand={() => undefined}
              onSelect={() => undefined}
              pending={null}
              projectLabel="app"
              selected={false}
              view={threadView(reachability)}
            />
          </ul>
        </AgentClockProvider>,
      );
    });
  }

  const text = (): string => host.textContent ?? "";
  const workTitle = (): string => host.querySelector(".agent-work__title")?.textContent ?? "";

  it("shows live work with a ticking duration while the server is reachable", async () => {
    await renderSession(REMOTE_RUNNER_REACHABLE);

    expect(text()).toContain("Still checking the suite");
    expect(workTitle()).toContain("Working for");
    expect(host.querySelector("[data-server-wait]")).toBeNull();
    const before = workTitle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(workTitle()).not.toBe(before);
  });

  it("replaces the live status with a calm named wait and stops the ticking duration", async () => {
    await renderSession(REMOTE_RUNNER_RECONNECTING);

    expect(text()).toContain("Still checking the suite");
    expect(text()).toContain("Waiting for Linux…");
    expect(text()).not.toContain("Working…");
    expect(workTitle()).not.toContain("Working for");
    const wait = host.querySelector("[data-server-wait]");
    expect(wait?.getAttribute("data-server-wait")).toBe("reconnecting");
    expect(wait?.className).toBe("cv-live-row");
    const before = workTitle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(workTitle()).toBe(before);
  });

  it("names a disconnected server instead of waiting for it", async () => {
    await renderSession(remoteRunnerDisconnected("serverDisconnected"));

    expect(text()).toContain("Linux is disconnected");
    expect(text()).not.toContain("Waiting for Linux…");
    expect(workTitle()).not.toContain("Working for");
  });

  it("returns to live work when the server is reachable again", async () => {
    await renderSession(REMOTE_RUNNER_RECONNECTING);
    expect(text()).toContain("Waiting for Linux…");

    await renderSession(REMOTE_RUNNER_REACHABLE);

    expect(host.querySelector("[data-server-wait]")).toBeNull();
    expect(workTitle()).toContain("Working for");
  });

  it("shows the interrupted turn as ended once the runner reports it", async () => {
    await renderSession(REMOTE_RUNNER_RECONNECTING);
    linux.interruptTasks();

    await renderSession(REMOTE_RUNNER_REACHABLE);

    expect(host.querySelector("[data-server-wait]")).toBeNull();
    expect(text()).toContain("The remote run ended before this turn finished.");
    expect(workTitle()).not.toContain("Working for");
  });

  it("keeps the rail row truthful without a ticking counter", async () => {
    await renderRow(REMOTE_RUNNER_REACHABLE);
    const status = () => host.querySelector(".cv-card-row__status");
    expect(status()?.querySelector(".cv-card-row__status-label")?.textContent).toBe("Working");
    expect(status()?.querySelector(".cv-card-row__tick")).not.toBeNull();

    await renderRow(REMOTE_RUNNER_RECONNECTING);
    expect(status()?.querySelector(".cv-card-row__status-label")?.textContent).toBe(
      "Waiting for server",
    );
    expect(status()?.getAttribute("title")).toBe(
      "The server is reconnecting. This is the last known state.",
    );
    expect(status()?.querySelector(".cv-card-row__tick")).toBeNull();
    const label = status()?.textContent;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(status()?.textContent).toBe(label);

    await renderRow(remoteRunnerDisconnected("serverDisconnected"));
    expect(status()?.querySelector(".cv-card-row__status-label")?.textContent).toBe(
      "Server disconnected",
    );
    expect(status()?.querySelector(".cv-card-row__tick")).toBeNull();

    await renderRow(REMOTE_RUNNER_REACHABLE);
    expect(status()?.querySelector(".cv-card-row__status-label")?.textContent).toBe("Working");
    expect(status()?.querySelector(".cv-card-row__tick")).not.toBeNull();
  });
});

describe("live progress indicators while the server is not reachable", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const monitor: AgentTurnEvent = {
    kind: "backgroundTask",
    taskId: "watch",
    taskType: "monitor",
    status: "starting",
    description: "Watching pipeline 400200",
  };
  const answer: AgentTurnEvent = {
    kind: "result",
    text: "I will report the pipeline result.",
    isError: false,
    usage: null,
  };
  const tool: AgentTurnEvent = {
    kind: "toolCall",
    name: "Bash",
    toolId: "shell",
    inputSummary: "Watch pipeline",
  };
  const agents: readonly AgentTurnEvent[] = [
    {
      kind: "toolCall",
      toolId: "spawn-a",
      name: "Agent",
      inputSummary: "prompt a",
      description: "Stream A backend",
    },
    {
      kind: "toolCall",
      toolId: "spawn-b",
      name: "Agent",
      inputSummary: "prompt b",
      description: "Stream B gateway",
    },
    { kind: "subagent", status: "starting", toolId: "spawn-a", taskId: "task-a" },
    { kind: "subagent", status: "starting", toolId: "spawn-b", taskId: "task-b" },
    { kind: "assistantText", text: "Lead keeps working." },
    { kind: "toolCall", toolId: "lead-read", name: "Read", inputSummary: "src/app.ts" },
  ];

  interface Scene {
    readonly events: readonly AgentTurnEvent[];
    readonly status?: AgentTurnStatus;
    readonly provider?: AgentCliKind;
    readonly prompt?: string;
  }

  async function render(scene: Scene, reachability: RemoteRunnerReachability): Promise<void> {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt: scene.prompt ?? "Watch pipeline",
      status: scene.status ?? { kind: "running" },
      events: scene.events,
      startedAtEpochMs: NOW - 10_000,
      endedAtEpochMs: null,
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
    };
    const view: AgentThreadView = {
      execution: {
        kind: "remote",
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        conversationId: "conversation",
        latestTaskId: "turn",
        resume: null,
        reachability,
      },
      thread: {
        threadId: "thread",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: scene.provider ?? "claudeCode", sessionId: "session" },
        title: "Pipeline",
        pinned: false,
        archived: false,
        createdAtEpochMs: 0,
        updatedAtEpochMs: 0,
        turns: [turn],
        turnsTruncated: false,
        integration: null,
        viewedAtEpochMs: null,
        externalOrigin: null,
      },
      ship: { kind: "idle", status: null, loadingStatus: false },
      editorAvailability: { kind: "available" },
      attention: "running",
      unread: false,
      lifecycle: "running",
      repositoryLabel: "app",
      projectOrigin: "active-tab",
      worktreeRemoved: false,
      worktreeMissing: false,
      changeSummary: null,
    };
    await act(async () => {
      root.render(
        <AgentAgentsPanelProvider isOpen={false} onOpen={noop} onToggle={noop}>
          <AgentThreadSession composerRepositoryLabel="app" onReviewInDiff={noop} thread={view} />
        </AgentAgentsPanelProvider>,
      );
    });
  }

  const text = (): string => host.textContent ?? "";
  const waiting = (): boolean => host.querySelector("[data-server-wait]") !== null;
  const dockBar = (): string | null =>
    host.querySelector(".cv-session-dock__banners .cv-composer-banner")?.textContent ?? null;

  it.each([
    { name: "Monitoring", scene: { events: [tool, monitor, answer] }, label: "Monitoring" },
    {
      name: "Working in background",
      scene: { events: [{ ...monitor, taskType: "agent" } satisfies AgentTurnEvent, answer] },
      label: "Working in background",
    },
    {
      name: "Compacting context",
      scene: {
        events: [
          tool,
          { kind: "contextCompactionStatus", status: "compacting", message: null },
        ] satisfies AgentTurnEvent[],
        prompt: "Inspect code",
      },
      label: "Compacting context…",
    },
    {
      name: "the pending Codex start",
      scene: { events: [], status: { kind: "pending" }, provider: "codex", prompt: "hello" },
      label: "Starting Codex…",
    },
  ] satisfies ReadonlyArray<{ name: string; scene: Scene; label: string }>)(
    "replaces $name with the server wait and brings it back on recovery",
    async ({ scene, label }) => {
      await render(scene, REMOTE_RUNNER_REACHABLE);
      expect(text()).toContain(label);
      expect(waiting()).toBe(false);

      await render(scene, REMOTE_RUNNER_RECONNECTING);
      expect(text()).not.toContain(label);
      expect(waiting()).toBe(true);
      expect(text()).toContain(scene.prompt ?? "Watch pipeline");

      await render(scene, REMOTE_RUNNER_REACHABLE);
      expect(text()).toContain(label);
      expect(waiting()).toBe(false);
    },
  );

  it("keeps the cached answer visible while the background indicator is withheld", async () => {
    await render({ events: [tool, monitor, answer] }, REMOTE_RUNNER_RECONNECTING);

    expect(text()).toContain("I will report the pipeline result.");
    expect(text()).not.toContain("Watching pipeline 400200");
  });

  it("withholds running agents in the turn and in the session dock", async () => {
    const scene = { events: agents, prompt: "Delegate" };
    const turnIndicator = (): string | null =>
      host.querySelector(".cv-live-row__action .cv-live-row__label")?.textContent ?? null;
    await render(scene, REMOTE_RUNNER_REACHABLE);
    expect(turnIndicator()).toBe("2 agents running");
    expect(dockBar()).toContain("2 agents running");

    await render(scene, remoteRunnerDisconnected("serverDisconnected"));
    expect(turnIndicator()).toBeNull();
    expect(dockBar()).toBeNull();
    expect(text()).not.toContain("agents running");
    expect(text()).toContain("Lead keeps working.");
    expect(waiting()).toBe(true);

    await render(scene, REMOTE_RUNNER_REACHABLE);
    expect(turnIndicator()).toBe("2 agents running");
    expect(dockBar()).toContain("2 agents running");
  });

  it("stops presenting reasoning and the turn clock as live", async () => {
    const scene = {
      events: [
        { kind: "assistantText", text: "Checking the router." },
        { kind: "reasoning", text: "Weighing the options." },
      ] satisfies AgentTurnEvent[],
      prompt: "Think",
    };
    const liveLabels = (): number =>
      host.querySelectorAll(".agent-activity-group__label--live, .agent-tool-row--working").length;
    const clock = (): string | null =>
      host.querySelector(".cv-turn-meta__duration")?.textContent ?? null;
    await render(scene, REMOTE_RUNNER_REACHABLE);
    const liveBefore = liveLabels();
    expect(liveBefore).toBeGreaterThan(0);
    expect(clock()).not.toBeNull();

    await render(scene, REMOTE_RUNNER_RECONNECTING);
    expect(liveLabels()).toBe(0);
    expect(clock()).toBeNull();
    expect(text()).toContain("Checking the router.");
    expect(waiting()).toBe(true);

    await render(scene, REMOTE_RUNNER_REACHABLE);
    expect(liveLabels()).toBe(liveBefore);
    expect(clock()).not.toBeNull();
  });
});

function noop(): void {
  return undefined;
}
