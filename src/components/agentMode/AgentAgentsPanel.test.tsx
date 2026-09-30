// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectAgentRuntimeSubagents,
  reconcileAgentRuntimeSubagents,
  type AgentRuntimeSubagentSource,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import { AgentAgentsPanel } from "./AgentAgentsPanel";
import {
  MAX_AGENTS_PANEL_ROWS,
  agentAgentsPanelModel,
  type AgentAgentsPanelGroup,
} from "./agentAgentsPanelPresentation";

function source(overrides: Partial<AgentRuntimeSubagentSource>): AgentRuntimeSubagentSource {
  return {
    id: "tool:a",
    batchId: "spawn:a",
    observedState: "running",
    resumable: false,
    activityOrder: 0,
    ...overrides,
  };
}

function group(
  key: string,
  sources: ReadonlyArray<AgentRuntimeSubagentSource>,
  previous: AgentRuntimeSubagents | null = null,
): AgentAgentsPanelGroup {
  return {
    key,
    subagents: reconcileAgentRuntimeSubagents(
      previous,
      projectAgentRuntimeSubagents(sources, false),
    ),
  };
}

describe("AgentAgentsPanel", () => {
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
    vi.useRealTimers();
  });

  it("shows the empty state when the thread has no agents", () => {
    act(() => root.render(<AgentAgentsPanel groups={[]} />));
    expect(host.querySelector(".cv-agents__empty-title")?.textContent).toBe("No agents yet");
    expect(host.querySelector(".cv-agents__list")).toBeNull();
    expect(host.querySelector(".cv-agents__foot")).toBeNull();
  });

  it("renders the three-line row anatomy in stable spawn order across turns", () => {
    const groups = [
      group("t1", [
        source({
          id: "a",
          title: "Stream 0 contract",
          role: "general-purpose",
          model: "opus-5",
          observedState: "completed",
          durationMs: 654_000,
          totalTokens: 137_000,
          toolUses: 35,
          outcome: "167 tests passed\nmore",
        }),
      ]),
      group("t2", [
        source({ id: "a", title: "Stream A", progress: "Reading hosts.rs", durationMs: 192_000 }),
        source({ id: "b", title: "Breaks", observedState: "failed", outcome: "cargo test failed" }),
      ]),
    ];
    act(() => root.render(<AgentAgentsPanel groups={groups} />));
    const current = [
      ...host.querySelectorAll<HTMLElement>(
        '.cv-agents__section[data-section="current"] .cv-agents-row',
      ),
    ];
    expect(current.map((row) => row.querySelector(".cv-agents-row__name")?.textContent)).toEqual([
      "Stream A",
      "Breaks",
    ]);
    const earlier = host.querySelector<HTMLButtonElement>(".cv-agents-earlier");
    expect(host.querySelectorAll(".cv-agents-earlier")).toHaveLength(1);
    expect(earlier?.getAttribute("aria-expanded")).toBe("false");
    expect(earlier?.textContent).toContain("Ran 1 subagent");
    act(() => earlier?.click());
    expect(earlier?.getAttribute("aria-expanded")).toBe("true");
    const rows = [...host.querySelectorAll<HTMLElement>(".cv-agents-row")];

    expect(rows.map((row) => row.querySelector(".cv-agents-row__name")?.textContent)).toEqual([
      "Stream A",
      "Breaks",
      "Stream 0 contract",
    ]);
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual([
      "working",
      "failed",
      "completed",
    ]);
    expect(rows[2]?.querySelector(".cv-role")?.textContent).toBe("general-purpose");
    expect(rows[2]?.querySelector(".cv-agents-row__elapsed")?.textContent).toBe("10m 54s");
    expect(rows[2]?.querySelector(".cv-agents-row__elapsed svg")).not.toBeNull();
    expect(rows[2]?.querySelector(".cv-agents-row__activity")?.textContent).toBe(
      "167 tests passed",
    );
    expect(rows[2]?.querySelector(".cv-agents-row__metrics")?.textContent).toBe(
      "opus-5 · 137.0k tok · 35 tools",
    );
    expect(rows[0]?.querySelector(".cv-agents-row__metrics")?.textContent).toBe("— tok");
    expect(rows[1]?.querySelector(".cv-agents-row__activity")?.textContent).toBe(
      "cargo test failed",
    );
    expect(rows[1]?.querySelector(".cv-agents-row__elapsed")?.textContent).toBe("");
    expect(
      [...host.querySelectorAll(".cv-agents__foot .cv-agents__count")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["● 1 working", "2 settled"]);
    expect(host.querySelector(".cv-agents__total")?.textContent).toBe("Σ 137.0k tok");
    expect(host.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(0);
  });

  it("ticks live elapsed time through DOM writes from one interval without React commits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const probe = vi.fn();
    const groups = [
      group("t1", [
        source({ id: "a", title: "One", durationMs: 58_000 }),
        source({ id: "b", title: "Two", durationMs: 5_000 }),
        source({ id: "c", title: "Done", observedState: "completed", durationMs: 9_000 }),
      ]),
    ];
    act(() => root.render(<AgentAgentsPanel groups={groups} rowRenderProbe={probe} />));
    const elapsed = () =>
      [...host.querySelectorAll(".cv-agents-row__elapsed")].map((node) => node.textContent);
    expect(elapsed()).toEqual(["58s", "5s", "9s"]);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const commits = probe.mock.calls.length;

    vi.advanceTimersByTime(3_000);
    expect(elapsed()).toEqual(["1m 01s", "8s", "9s"]);
    expect(probe.mock.calls.length).toBe(commits);

    act(() => root.render(<div />));
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("re-renders only the row whose agent changed", () => {
    const probe = vi.fn();
    const sources = [
      source({ id: "a", title: "One", progress: "steady" }),
      source({ id: "b", title: "Two", progress: "before" }),
    ];
    const first = group("t1", sources);
    act(() => root.render(<AgentAgentsPanel groups={[first]} rowRenderProbe={probe} />));
    probe.mockClear();

    const second = group(
      "t1",
      [sources[0]!, { ...sources[1]!, progress: "after", totalTokens: 10 }],
      first.subagents,
    );
    act(() => root.render(<AgentAgentsPanel groups={[second]} rowRenderProbe={probe} />));

    expect(probe.mock.calls.map(([id]) => id)).toEqual(["b"]);
    expect(host.querySelectorAll(".cv-agents-row__activity")[1]?.textContent).toBe("after");
  });

  it("marks a silent agent as stale through DOM writes and clears it on the next report", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const probe = vi.fn();
    const first = group("t1", [source({ id: "a", title: "One", durationMs: 60_000 })]);
    act(() => root.render(<AgentAgentsPanel groups={[first]} rowRenderProbe={probe} />));
    const commits = probe.mock.calls.length;
    const text = (selector: string) => host.querySelector(selector)?.textContent;

    vi.advanceTimersByTime(6 * 3_600_000);
    expect(text(".cv-agents-row__elapsed")).toBe("3m 00s");
    expect(text(".cv-agents-row__stale")).toBe("no update for 6h 00m");
    expect(host.querySelector(".cv-agents-row")?.getAttribute("data-status")).toBe("working");
    expect(probe.mock.calls.length).toBe(commits);

    const second = group(
      "t1",
      [source({ id: "a", title: "One", durationMs: 75_000 })],
      first.subagents,
    );
    act(() => root.render(<AgentAgentsPanel groups={[second]} rowRenderProbe={probe} />));
    expect(text(".cv-agents-row__elapsed")).toBe("1m 15s");
    expect(text(".cv-agents-row__stale")).toBe("");
  });

  it("exposes live elapsed time as a static description instead of a per-second one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    act(() =>
      root.render(
        <AgentAgentsPanel groups={[group("t1", [source({ id: "a", durationMs: 58_000 })])]} />,
      ),
    );
    const hidden = () =>
      [...host.querySelectorAll(".cv-agents-row .agent-visually-hidden")].map(
        (node) => node.textContent,
      );
    expect(hidden()).toEqual(["Working", "Elapsed 58s"]);

    vi.advanceTimersByTime(29_000);
    expect(hidden()).toEqual(["Working", "Elapsed 58s"]);
    vi.advanceTimersByTime(1_000);
    expect(hidden()).toEqual(["Working", "Elapsed 1m 28s"]);
    expect(host.querySelector(".cv-agents-row__elapsed span")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("states truncation once above the list and shows nested agents and unknown tasks", () => {
    const truncated: AgentAgentsPanelGroup = {
      key: "t1",
      subagents: projectAgentRuntimeSubagents(
        [
          source({ id: "a", title: "Lead", nestedCount: 2, totalTokens: 1_000 }),
          source({ id: "b", role: "general-purpose", observedState: "completed" }),
        ],
        true,
      ),
    };
    act(() => root.render(<AgentAgentsPanel groups={[truncated]} />));
    const rows = [...host.querySelectorAll<HTMLElement>(".cv-agents-row")];

    expect(host.querySelector(".cv-agents__notice")?.textContent).toBe(
      "Showing the first 2 agents",
    );
    expect(host.querySelectorAll(".cv-agents__notice")).toHaveLength(1);
    expect(rows[0]?.querySelector(".cv-agents-row__metrics")?.textContent).toBe(
      "1.0k tok · +2 nested agents",
    );
    expect(rows[1]?.getAttribute("data-title")).toBe("unknown");
    expect(rows[1]?.querySelector(".cv-role")?.textContent).toBe("general-purpose");
    expect(rows[1]?.querySelector(".cv-agents-row__activity")?.textContent).toBe("task unknown");
  });

  it("renders a collapsed recent activity history that stays open across live updates", () => {
    const history = ["Reading a.ts", "▸ Grep", "Running npx vitest run"];
    const first = group("t1", [source({ id: "a", title: "One", recentActivity: history })]);
    act(() => root.render(<AgentAgentsPanel groups={[first]} />));
    const toggle = () => host.querySelector<HTMLButtonElement>(".cv-agents-recent > button");
    const entries = () =>
      [...host.querySelectorAll(".cv-agents-recent ol li")].map((node) => node.textContent);

    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle()?.textContent).toBe("Recent activity · 3");
    expect(host.querySelector(".cv-agents-recent ol")).toBeNull();

    act(() => toggle()?.click());
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    const listId = toggle()?.getAttribute("aria-controls");
    expect(host.querySelector(".cv-agents-recent ol")?.id).toBe(listId);
    expect(entries()).toEqual(history);

    const longer = [...history, "Step 4", "Step 5", "Step 6", "Step 7"];
    const second = group(
      "t1",
      [source({ id: "a", title: "One", recentActivity: longer })],
      first.subagents,
    );
    act(() => root.render(<AgentAgentsPanel groups={[second]} />));

    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(entries()).toEqual([
      "▸ Grep",
      "Running npx vitest run",
      "Step 4",
      "Step 5",
      "Step 6",
      "Step 7",
    ]);
    expect(toggle()?.textContent).toBe("Recent activity · 6");
  });

  it("omits the history for an agent that has reported no activity", () => {
    act(() => root.render(<AgentAgentsPanel groups={[group("t1", [source({ id: "a" })])]} />));

    expect(host.querySelector(".cv-agents-row")).not.toBeNull();
    expect(host.querySelector(".cv-agents-recent")).toBeNull();
  });

  it("bounds the rendered rows and says so", () => {
    const groups = Array.from({ length: 4 }, (_, turn) =>
      group(
        `t${turn}`,
        Array.from({ length: 32 }, (_, index) => source({ id: `a${index}`, totalTokens: 1 })),
      ),
    );
    const model = agentAgentsPanelModel(groups);
    const earlierRows = model.earlier.flatMap((entry) => entry.rows);
    expect(model.current).toHaveLength(32);
    expect(model.current.length + earlierRows.length).toBe(MAX_AGENTS_PANEL_ROWS);
    expect(model.earlier.map((entry) => entry.key)).toEqual(["t2", "t1"]);
    expect(model.notice).toBe(`Showing the latest ${MAX_AGENTS_PANEL_ROWS} agents`);
    expect(model.totalTokens).toBe(128);
    expect(model.current[model.current.length - 1]?.key).toBe("t3:a31");
  });

  it("counts subagents Codevo stopped following as status unknown, not settled", () => {
    const groups = [
      group("t1", [
        source({ id: "a", title: "sleep_agent_1", observedState: "unknown" }),
        source({ id: "b", title: "sleep_agent_2", observedState: "unknown" }),
      ]),
    ];
    act(() => root.render(<AgentAgentsPanel groups={groups} />));
    expect(
      [...host.querySelectorAll(".cv-agents__count")].map((count) => count.textContent),
    ).toEqual(["2 status unknown"]);
  });
});
