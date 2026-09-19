// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectAgentRuntimeSubagents,
  reconcileAgentRuntimeSubagents,
  type AgentRuntimeSubagentSource,
} from "../../domain/agentRuntimeSubagent";
import { AgentSubagentDisclosure } from "./AgentSubagentDisclosure";

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

describe("AgentSubagentDisclosure", () => {
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

  function render(
    sources: ReadonlyArray<AgentRuntimeSubagentSource>,
    truncated = false,
    onOpenAgents?: () => void,
  ) {
    const subagents = projectAgentRuntimeSubagents(sources, truncated);
    act(() =>
      root.render(<AgentSubagentDisclosure onOpenAgents={onOpenAgents} subagents={subagents} />),
    );
  }

  const row = () => host.querySelector<HTMLButtonElement>(".agent-spawn__row");

  it("renders nothing without subagents", () => {
    render([]);
    expect(host.textContent).toBe("");
  });

  it.each([
    [
      [source({ id: "a" }), source({ id: "b", observedState: "completed" })],
      false,
      "Kicked off 2 subagents",
      "1 working",
      "working",
    ],
    [
      [source({ id: "a", observedState: "completed" })],
      false,
      "Ran 1 subagent",
      "✓ completed",
      "completed",
    ],
    [
      [
        source({ id: "a", observedState: "failed" }),
        source({ id: "b", observedState: "failed" }),
        source({ id: "c", observedState: "completed" }),
      ],
      false,
      "Ran 3 subagents",
      "2 failed",
      "failed",
    ],
    [
      [source({ id: "a", observedState: "interrupted" })],
      false,
      "Ran 1 subagent",
      "stopped",
      "inactive",
    ],
    [
      [
        source({ id: "a", observedState: "interrupted" }),
        source({ id: "b", observedState: "completed" }),
      ],
      false,
      "Ran 2 subagents",
      "1 stopped",
      "inactive",
    ],
    [
      [
        source({ id: "a", observedState: "unknown" }),
        source({ id: "b", observedState: "completed" }),
      ],
      false,
      "Ran 2 subagents",
      "status unavailable",
      "inactive",
    ],
    [
      [source({ id: "a", observedState: "completed" })],
      true,
      "Ran 1 subagent",
      "✓ completed",
      "completed",
    ],
    [
      [source({ id: "a", observedState: "completed", resumable: true })],
      false,
      "Ran 1 subagent",
      "1 idle",
      "inactive",
    ],
  ] as const)("summarizes %#", (sources, truncated, lead, status, tone) => {
    render(sources, truncated);
    expect(host.querySelector(".agent-spawn__lead")?.textContent).toBe(lead);
    expect(host.querySelector(".agent-spawn__status")?.textContent).toBe(status);
    expect(host.querySelector(".agent-spawn")?.getAttribute("data-tone")).toBe(tone);
    expect(host.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(0);
    const dot = host.querySelector(".agent-spawn__row > .agent-spawn__dot");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(dot?.nextElementSibling).toBe(host.querySelector(".agent-spawn__lead"));
  });

  it("shows an unknown task truthfully: role chip kept and a muted task unknown line", () => {
    render([source({ id: "a", role: "general-purpose", observedState: "completed" })]);
    act(() => row()?.click());
    const member = host.querySelector(".agent-spawn-member");

    expect(member?.getAttribute("data-title")).toBe("unknown");
    expect(member?.querySelector(".agent-spawn-member__title")?.textContent).toBe(
      "general-purpose",
    );
    expect(member?.querySelector(".agent-spawn-member__role")?.textContent).toBe("general-purpose");
    expect(member?.querySelector(".agent-spawn-member__activity")?.textContent).toBe(
      "task unknown",
    );
  });

  it("starts collapsed, expands to one line per member and collapses again", () => {
    render([
      source({
        id: "a",
        title: "Stream A backend",
        role: "general-purpose",
        progress: "Reading hosts.rs\nsecond line",
      }),
      source({
        id: "b",
        title: "Stream B gateway",
        observedState: "completed",
        durationMs: 192_000,
        totalTokens: 61_200,
        outcome: "167 tests passed",
      }),
    ]);
    expect(row()?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".agent-spawn-member")).toBeNull();

    act(() => row()?.click());
    expect(row()?.getAttribute("aria-expanded")).toBe("true");
    const members = [...host.querySelectorAll(".agent-spawn-member")];
    expect(members).toHaveLength(2);
    expect(members[0]?.querySelector(".agent-spawn-member__title")?.textContent).toBe(
      "Stream A backend",
    );
    expect(members[0]?.querySelector(".agent-spawn-member__role")?.textContent).toBe(
      "general-purpose",
    );
    expect(members[0]?.querySelector(".agent-spawn-member__activity")?.textContent).toBe(
      "Reading hosts.rs",
    );
    expect(members[0]?.querySelector(".agent-spawn-member__meta")?.textContent).toBe("Working");
    expect(members[1]?.querySelector(".agent-spawn-member__role")).toBeNull();
    expect(members[1]?.querySelector(".agent-spawn-member__meta")?.textContent).toBe(
      "3m 12s · 61.2k tok",
    );

    act(() => row()?.click());
    expect(host.querySelector(".agent-spawn-member")).toBeNull();
  });

  it("expands a member into its full bounded activity and keeps expansion across updates", () => {
    const sources = [
      source({ id: "a", title: "Stream A", progress: "line one\nline two", model: "opus-5" }),
    ];
    render(sources);
    act(() => row()?.click());
    const head = () => host.querySelector<HTMLButtonElement>(".agent-spawn-member__head--action");
    expect(head()?.getAttribute("aria-expanded")).toBe("false");

    act(() => head()?.click());
    expect(head()?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".agent-spawn-member__body pre")?.textContent).toBe(
      "line one\nline two\n\nopus-5",
    );
    expect(host.querySelector(".agent-spawn-member__activity")).toBeNull();

    render([{ ...sources[0]!, observedState: "completed", outcome: "finished" }]);
    expect(row()?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".agent-spawn-member__body pre")?.textContent).toBe(
      "finished\n\nopus-5",
    );
  });

  it("does not manufacture an expandable body for members without details", () => {
    render([source({ id: "a", title: "Quiet" })]);
    act(() => row()?.click());
    expect(host.querySelector(".agent-spawn-member__head--action")).toBeNull();
    expect(host.querySelector(".agent-spawn-member__meta")?.textContent).toBe("Working");
  });

  it("opens the Agents panel from the expanded batch and leaves truncation to the panel", () => {
    const onOpenAgents = vi.fn();
    render([source({ id: "a" })], true, onOpenAgents);
    expect(host.querySelector(".agent-spawn__open")).toBeNull();
    act(() => row()?.click());
    expect(host.textContent).not.toContain("Additional subagents");
    const open = host.querySelector<HTMLButtonElement>(".agent-spawn__open");
    expect(open?.textContent).toBe("Open Agents panel ›");
    act(() => open?.click());
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });

  it("re-renders only the ticking member when one agent reports progress", () => {
    const probe = vi.fn();
    const sources = [
      source({ id: "a", title: "One", progress: "steady" }),
      source({ id: "b", title: "Two", progress: "before", totalTokens: 1 }),
    ];
    const first = projectAgentRuntimeSubagents(sources, false);
    act(() => root.render(<AgentSubagentDisclosure memberRenderProbe={probe} subagents={first} />));
    act(() => row()?.click());
    probe.mockClear();

    for (let tick = 2; tick < 12; tick += 1) {
      const next = reconcileAgentRuntimeSubagents(
        first,
        projectAgentRuntimeSubagents(
          [sources[0]!, { ...sources[1]!, progress: `tick ${tick}`, totalTokens: tick }],
          false,
        ),
      );
      act(() =>
        root.render(<AgentSubagentDisclosure memberRenderProbe={probe} subagents={next} />),
      );
    }

    expect(probe.mock.calls.map(([id]) => id)).toEqual(Array.from({ length: 10 }, () => "b"));
    expect(host.querySelector(".agent-spawn__status")?.textContent).toBe("2 working");
  });

  it("renders one quiet row per spawn batch", () => {
    render([source({ id: "a", batchId: "spawn:a" }), source({ id: "b", batchId: "spawn:b" })]);
    expect(host.querySelectorAll(".agent-spawn__row")).toHaveLength(2);
  });

  it("marks a legacy batch and never claims it was kicked off", () => {
    render([
      source({ id: "a", batchId: "legacy", observedState: "completed" }),
      source({ id: "b", batchId: "legacy" }),
    ]);

    expect(host.querySelector(".agent-spawn")?.getAttribute("data-origin")).toBe("legacy");
    expect(host.querySelector(".agent-spawn__lead")?.textContent).toBe("2 earlier subagents");
  });
});
