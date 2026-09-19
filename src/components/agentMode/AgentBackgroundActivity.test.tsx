// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectAgentRuntimeSubagents,
  type AgentRuntimeSubagentSource,
} from "../../domain/agentRuntimeSubagent";
import { AgentBackgroundActivity } from "./AgentBackgroundActivity";
import { agentBackgroundIndicator } from "./agentBackgroundIndicatorPresentation";

const INACTIVE = {
  phase: "inactive",
  foregroundSettled: false,
  tasks: [],
  truncated: false,
} as const;

const source = (id: string): AgentRuntimeSubagentSource => ({
  id,
  batchId: "spawn:a",
  observedState: "running",
  resumable: false,
  activityOrder: 0,
  title: `Job ${id}`,
});

describe("AgentBackgroundActivity agents indicator", () => {
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

  it("says at least when the thread projection is truncated", () => {
    const exact = projectAgentRuntimeSubagents([source("a"), source("b")], false);
    const bounded = projectAgentRuntimeSubagents([source("a"), source("b")], true);

    expect(agentBackgroundIndicator(INACTIVE, exact, "claudeCode")).toMatchObject({
      kind: "agents",
      label: "2 agents working",
    });
    expect(agentBackgroundIndicator(INACTIVE, bounded, "claudeCode")).toMatchObject({
      kind: "agents",
      label: "at least 2 agents working",
    });
  });

  it("stays a plain button without its own live region", () => {
    const onOpenAgents = vi.fn();
    const indicator = agentBackgroundIndicator(
      INACTIVE,
      projectAgentRuntimeSubagents([source("a")], false),
      "claudeCode",
    );
    act(() =>
      root.render(<AgentBackgroundActivity indicator={indicator} onOpenAgents={onOpenAgents} />),
    );

    expect(host.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(0);
    const action = host.querySelector<HTMLButtonElement>(".agent-background-row__action");
    expect(action?.getAttribute("aria-label")).toBe("1 agent working. Open Agents panel");
    act(() => action?.click());
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });
});
