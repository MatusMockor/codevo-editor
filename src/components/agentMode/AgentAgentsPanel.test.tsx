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
    expect(host.querySelector(".agents-panel__empty-title")?.textContent).toBe("No agents yet");
    expect(host.querySelector(".agents-panel__list")).toBeNull();
    expect(host.querySelector(".agents-panel__foot")).toBeNull();
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
    const rows = [...host.querySelectorAll<HTMLElement>(".agents-panel__row")];

    expect(rows.map((row) => row.querySelector(".agents-panel__name")?.textContent)).toEqual([
      "Stream 0 contract",
      "Stream A",
      "Breaks",
    ]);
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual([
      "completed",
      "working",
      "failed",
    ]);
    expect(rows[0]?.querySelector(".agents-panel__role")?.textContent).toBe("general-purpose");
    expect(rows[0]?.querySelector(".agents-panel__elapsed")?.textContent).toBe("10m 54s");
    expect(rows[0]?.querySelector(".agents-panel__elapsed svg")).not.toBeNull();
    expect(rows[0]?.querySelector(".agents-panel__activity")?.textContent).toBe("167 tests passed");
    expect(rows[0]?.querySelector(".agents-panel__metrics")?.textContent).toBe(
      "opus-5 · 137.0k tok · 35 tools",
    );
    expect(rows[1]?.querySelector(".agents-panel__metrics")?.textContent).toBe("— tok");
    expect(rows[2]?.querySelector(".agents-panel__activity")?.textContent).toBe(
      "cargo test failed",
    );
    expect(rows[2]?.querySelector(".agents-panel__elapsed")?.textContent).toBe("");
    expect(host.querySelector(".agents-panel__foot")?.textContent).toBe(
      "1 working · 2 settledΣ 137.0k tok",
    );
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
      [...host.querySelectorAll(".agents-panel__elapsed")].map((node) => node.textContent);
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
    expect(host.querySelectorAll(".agents-panel__activity")[1]?.textContent).toBe("after");
  });

  it("closes from the button and Escape, and takes focus only for a user-initiated open", () => {
    const onClose = vi.fn();
    const groups = [group("t1", [source({})])];
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    act(() => root.render(<AgentAgentsPanel groups={groups} onClose={onClose} />));
    expect(document.activeElement).toBe(opener);

    act(() => root.render(<div />));
    act(() => root.render(<AgentAgentsPanel autoFocus groups={groups} onClose={onClose} />));
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Close Agents panel"]');
    expect(document.activeElement).toBe(close);
    act(() => close?.click());
    act(() => {
      host
        .querySelector(".agents-panel")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    act(() => root.render(<div />));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("becomes a focus-trapped dialog only as a modal overlay", () => {
    const groups = [group("t1", [source({})])];
    act(() => root.render(<AgentAgentsPanel groups={groups} onClose={() => undefined} />));
    expect(host.querySelector(".agents-panel")?.getAttribute("role")).toBeNull();

    act(() => root.render(<AgentAgentsPanel groups={groups} modal onClose={() => undefined} />));
    const panel = host.querySelector<HTMLElement>(".agents-panel");
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Close Agents panel"]');
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(close);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => {
      close?.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
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
    expect(text(".agents-panel__elapsed")).toBe("3m 00s");
    expect(text(".agents-panel__stale")).toBe("no update for 6h 00m");
    expect(host.querySelector(".agents-panel__row")?.getAttribute("data-status")).toBe("working");
    expect(probe.mock.calls.length).toBe(commits);

    const second = group(
      "t1",
      [source({ id: "a", title: "One", durationMs: 75_000 })],
      first.subagents,
    );
    act(() => root.render(<AgentAgentsPanel groups={[second]} rowRenderProbe={probe} />));
    expect(text(".agents-panel__elapsed")).toBe("1m 15s");
    expect(text(".agents-panel__stale")).toBe("");
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
      [...host.querySelectorAll(".agents-panel__row .agent-visually-hidden")].map(
        (node) => node.textContent,
      );
    expect(hidden()).toEqual(["Working", "Elapsed 58s"]);

    vi.advanceTimersByTime(29_000);
    expect(hidden()).toEqual(["Working", "Elapsed 58s"]);
    vi.advanceTimersByTime(1_000);
    expect(hidden()).toEqual(["Working", "Elapsed 1m 28s"]);
    expect(host.querySelector(".agents-panel__elapsed span")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("states truncation once in the header and shows nested agents and unknown tasks", () => {
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
    const rows = [...host.querySelectorAll<HTMLElement>(".agents-panel__row")];

    expect(host.querySelector(".agents-panel__head .agents-panel__notice")?.textContent).toBe(
      "Showing the first 2 agents",
    );
    expect(host.querySelectorAll(".agents-panel__notice")).toHaveLength(1);
    expect(rows[0]?.querySelector(".agents-panel__metrics")?.textContent).toBe(
      "1.0k tok · +2 nested agents",
    );
    expect(rows[1]?.getAttribute("data-title")).toBe("unknown");
    expect(rows[1]?.querySelector(".agents-panel__role")?.textContent).toBe("general-purpose");
    expect(rows[1]?.querySelector(".agents-panel__activity")?.textContent).toBe("task unknown");
  });

  it("renders a collapsed recent activity history that stays open across live updates", () => {
    const history = ["Reading a.ts", "▸ Grep", "Running npx vitest run"];
    const first = group("t1", [source({ id: "a", title: "One", recentActivity: history })]);
    act(() => root.render(<AgentAgentsPanel groups={[first]} />));
    const details = host.querySelector<HTMLDetailsElement>(".agents-panel__history");
    const entries = () =>
      [...host.querySelectorAll(".agents-panel__history-entry")].map((node) => node.textContent);

    expect(details?.open).toBe(false);
    expect(host.querySelector(".agents-panel__history-summary")?.textContent).toBe(
      "Recent activity · 3",
    );
    expect(entries()).toEqual(history);

    act(() => {
      if (details !== null) details.open = true;
    });
    const longer = [...history, "Step 4", "Step 5", "Step 6", "Step 7"];
    const second = group(
      "t1",
      [source({ id: "a", title: "One", recentActivity: longer })],
      first.subagents,
    );
    act(() => root.render(<AgentAgentsPanel groups={[second]} />));

    expect(host.querySelector(".agents-panel__history")).toBe(details);
    expect(details?.open).toBe(true);
    expect(entries()).toEqual([
      "▸ Grep",
      "Running npx vitest run",
      "Step 4",
      "Step 5",
      "Step 6",
      "Step 7",
    ]);
    expect(host.querySelector(".agents-panel__history-summary")?.textContent).toBe(
      "Recent activity · 6",
    );
  });

  it("omits the history for an agent that has reported no activity", () => {
    act(() => root.render(<AgentAgentsPanel groups={[group("t1", [source({ id: "a" })])]} />));

    expect(host.querySelector(".agents-panel__row")).not.toBeNull();
    expect(host.querySelector(".agents-panel__history")).toBeNull();
  });

  it("bounds the rendered rows and says so", () => {
    const groups = Array.from({ length: 4 }, (_, turn) =>
      group(
        `t${turn}`,
        Array.from({ length: 32 }, (_, index) => source({ id: `a${index}`, totalTokens: 1 })),
      ),
    );
    const model = agentAgentsPanelModel(groups);
    expect(model.rows).toHaveLength(MAX_AGENTS_PANEL_ROWS);
    expect(model.notice).toBe(`Showing the latest ${MAX_AGENTS_PANEL_ROWS} agents`);
    expect(model.totalTokens).toBe(128);
    expect(model.rows[model.rows.length - 1]?.key).toBe("t3:a31");
  });
});
