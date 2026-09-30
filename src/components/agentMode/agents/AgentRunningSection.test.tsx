// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectAgentRuntimeSubagents,
  type AgentRuntimeSubagentSource,
} from "../../../domain/agentRuntimeSubagent";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";
import { AgentAgentsPanel } from "../AgentAgentsPanel";
import type { AgentAgentsPanelGroup } from "../agentAgentsPanelPresentation";
import {
  MAX_AGENT_RUNNING_ROWS,
  agentRunningStopReasonText,
  agentRunningWork,
  type AgentRunningStopPolicy,
} from "./agentRunningWork";
import type { AgentRunningWorkSurface } from "./agentAgentsPanelHooks";

const NOW = 1_800_000_000_000;

function source(id: string, overrides: Partial<AgentRuntimeSubagentSource> = {}) {
  return {
    id,
    batchId: "entry:batch",
    observedState: "running",
    resumable: false,
    activityOrder: 0,
    title: `Agent ${id}`,
    ...overrides,
  } satisfies AgentRuntimeSubagentSource;
}

function group(key: string, sources: ReadonlyArray<AgentRuntimeSubagentSource>) {
  return {
    key,
    subagents: projectAgentRuntimeSubagents(sources, false),
  } satisfies AgentAgentsPanelGroup;
}

function session(tasks: AgentSessionBackground["tasks"]): AgentSessionBackground {
  return {
    ownerId: "ws-1",
    total: tasks.length,
    agents: tasks.filter((task) => task.taskType === "agent").length,
    tasks,
    sinceEpochMs: NOW - 125_000,
    taskSinceEpochMs: new Map(tasks.map((task) => [task.taskId, NOW - 125_000])),
  };
}

function surface(
  groups: ReadonlyArray<AgentAgentsPanelGroup>,
  background: AgentSessionBackground | null,
  stop: AgentRunningStopPolicy,
  stopTask: (taskId: string) => void,
  provider: "claudeCode" | "codex" = "claudeCode",
): AgentRunningWorkSurface {
  return {
    threadId: "agt-1",
    work: agentRunningWork({ provider, groups, session: background, live: null, stop }),
    stopTask,
  };
}

function button(label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    ) ?? null
  );
}

const STABLE_STOP = (): void => undefined;

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

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Agents panel running section", () => {
  it("lists every running agent and background task once with name, elapsed and status", () => {
    const groups = [
      group("t1", [
        source("tool-a", { taskId: "task-a", title: "Restore app state", durationMs: 60_000 }),
        source("tool-done", { observedState: "completed", title: "Map persistence" }),
      ]),
    ];
    const background = session([
      { taskId: "task-a", taskType: "agent", description: "Restore app state" },
      { taskId: "s1", taskType: "shell", description: "Watch release workflow" },
    ]);
    const running = surface(
      groups,
      background,
      { kind: "perTask", pendingTaskIds: new Set() },
      () => undefined,
    );
    act(() => root.render(<AgentAgentsPanel groups={groups} running={running} />));

    const section = host.querySelector('.cv-agents__section[data-section="running"]');
    expect(section?.querySelector(".cv-agents__label")?.textContent).toBe("Running · 2");
    const rows = [...(section?.querySelectorAll<HTMLElement>(".cv-agents-row") ?? [])];
    expect(rows.map((row) => row.querySelector(".cv-agents-row__name")?.textContent)).toEqual([
      "Restore app state",
      "Watch release workflow",
    ]);
    expect(rows[1]?.querySelector(".cv-agents-row__elapsed")?.textContent).toBe("2m 05s");
    expect(rows[1]?.querySelector(".cv-agents-row__activity")?.textContent).toBe(
      "Running in background",
    );
    expect(rows[1]?.textContent).toContain("Shell");
    expect(rows[1]?.textContent).not.toContain("task s1");
    const current = [
      ...host.querySelectorAll('.cv-agents__section[data-section="current"] .cv-agents-row'),
    ];
    expect(current.map((row) => row.querySelector(".cv-agents-row__name")?.textContent)).toEqual([
      "Map persistence",
    ]);
  });

  it("stops one row through the exact per-task stop and shows Stopping… while it ends", () => {
    const stopTask = vi.fn();
    const background = session([
      { taskId: "s1", taskType: "shell", description: "Watch release workflow" },
      { taskId: "a2", taskType: "agent", description: "Resumed reviewer" },
    ]);
    const render = (pending: ReadonlySet<string>) =>
      act(() =>
        root.render(
          <AgentAgentsPanel
            groups={[]}
            running={surface(
              [],
              background,
              { kind: "perTask", pendingTaskIds: pending },
              stopTask,
            )}
          />,
        ),
      );
    render(new Set());
    const stop = button('Stop background task "Watch release workflow"');
    expect(stop?.textContent).toBe("Stop");
    act(() => stop?.focus());
    act(() => stop?.click());
    expect(stopTask).toHaveBeenCalledExactlyOnceWith("s1");

    render(new Set(["s1"]));
    const stopping = button('Stopping "Watch release workflow"');
    expect(stopping?.textContent).toBe("Stopping…");
    expect(stopping?.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(stopping);
    expect(stopping?.closest(".cv-agents-row")?.getAttribute("data-status")).toBe("stopping");
    expect(stopping?.closest(".cv-agents-row")?.textContent).toContain("Stopping…");
    act(() => stopping?.click());
    expect(stopTask).toHaveBeenCalledTimes(1);
    expect(button('Stop background task "Resumed reviewer"')?.disabled).toBe(false);
  });

  it("marks a subagent row stopping in its status and activity line", () => {
    const groups = [group("t1", [source("tool-a", { taskId: "task-a", title: "Reviewer" })])];
    const background = session([{ taskId: "task-a", taskType: "agent" }]);
    act(() =>
      root.render(
        <AgentAgentsPanel
          groups={groups}
          running={surface(
            groups,
            background,
            { kind: "perTask", pendingTaskIds: new Set(["task-a"]) },
            () => undefined,
          )}
        />,
      ),
    );
    const row = button('Stopping "Reviewer"')?.closest(".cv-agents-row");
    expect(row?.getAttribute("data-status")).toBe("stopping");
    expect(row?.querySelector(".cv-agents-row__activity-text")?.textContent).toBe("Stopping…");
  });

  it("offers no dead Stop and names the reason once for rows that cannot stop alone", () => {
    const groups = [
      group("t1", [
        source("thread:a", { title: "Codex worker" }),
        source("thread:b", { title: "Codex reviewer" }),
      ]),
    ];
    act(() =>
      root.render(
        <AgentAgentsPanel
          groups={groups}
          running={surface(
            groups,
            null,
            { kind: "perTask", pendingTaskIds: new Set() },
            () => undefined,
            "codex",
          )}
        />,
      ),
    );
    const section = host.querySelector('.cv-agents__section[data-section="running"]');
    expect(section?.querySelectorAll("button.cv-agents-row__stop")).toHaveLength(0);
    const notes = section?.querySelectorAll(".cv-agents__running-note") ?? [];
    expect([...notes].map((note) => note.textContent)).toEqual([
      agentRunningStopReasonText("codex"),
    ]);
    const items = [...(section?.querySelectorAll(".cv-agents-item") ?? [])];
    expect(items).toHaveLength(2);
    for (const item of items)
      expect(item.getAttribute("aria-describedby")).toBe(notes[0]?.getAttribute("id"));
  });

  it("re-renders only the row whose stop changed", () => {
    const probe = vi.fn();
    const groups = [group("t1", [source("tool-a", { taskId: "task-a" })])];
    const background = session([
      { taskId: "task-a", taskType: "agent" },
      { taskId: "s1", taskType: "shell" },
      { taskId: "s2", taskType: "shell" },
    ]);
    const render = (pending: ReadonlySet<string>) =>
      act(() =>
        root.render(
          <AgentAgentsPanel
            groups={groups}
            rowRenderProbe={probe}
            running={surface(
              groups,
              background,
              { kind: "perTask", pendingTaskIds: pending },
              STABLE_STOP,
            )}
          />,
        ),
      );
    render(new Set());
    expect(probe.mock.calls.map(([id]) => id).sort()).toEqual(["s1", "s2", "tool-a"]);
    probe.mockClear();
    render(new Set());
    expect(probe).not.toHaveBeenCalled();
    render(new Set(["s2"]));
    expect(probe.mock.calls.map(([id]) => id)).toEqual(["s2"]);
  });

  it("bounds the rendered rows and says how many more run", () => {
    const tasks = Array.from({ length: MAX_AGENT_RUNNING_ROWS + 4 }, (_, index) => ({
      taskId: `s${index}`,
      taskType: "shell" as const,
    }));
    act(() =>
      root.render(
        <AgentAgentsPanel
          groups={[]}
          running={surface(
            [],
            session(tasks),
            { kind: "perTask", pendingTaskIds: new Set() },
            () => undefined,
          )}
        />,
      ),
    );
    expect(
      host.querySelectorAll('.cv-agents__section[data-section="running"] .cv-agents-row'),
    ).toHaveLength(MAX_AGENT_RUNNING_ROWS);
    expect(host.querySelector(".cv-agents__running-more")?.textContent).toBe(
      "+4 more running, not listed here",
    );
    expect(host.querySelector(".cv-agents__empty")).toBeNull();
  });
});
