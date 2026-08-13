// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentStatusBar, type AgentStatusBarProps } from "./AgentStatusBar";

describe("AgentStatusBar", () => {
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

  it("shows live agent slots with a live dot", () => {
    render({ liveTaskCount: 2 });

    expect(host.textContent).toContain("2/3 agents running");
    expect(host.querySelector(".status-agent-dot--live")).not.toBeNull();
  });

  it("reports idle slots without pretending a run is live", () => {
    render({ liveTaskCount: 0 });

    expect(host.textContent).toContain("Agents idle · 3 slots");
    expect(host.querySelector(".status-agent-dot--live")).toBeNull();
    expect(host.querySelector(".status-agent-dot")).not.toBeNull();
  });

  it("names the workspace and its exact trust state", () => {
    render({ workspaceRoot: "/projects/myproject", workspaceTrusted: false });

    const labels = [...host.querySelectorAll("footer > span")].map((span) => span.textContent);
    expect(labels).toContain("myproject");
    expect(labels).toContain("Untrusted");
    expect(labels).not.toContain("Trusted");
  });

  it("omits workspace items without a workspace", () => {
    render({ workspaceRoot: null });

    const labels = [...host.querySelectorAll("footer > span")].map((span) => span.textContent);
    expect(labels).toHaveLength(1);
  });

  function render(overrides: Partial<AgentStatusBarProps> = {}): void {
    act(() => root.render(<AgentStatusBar {...defaultProps()} {...overrides} />));
  }
});

function defaultProps(): AgentStatusBarProps {
  return {
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 3,
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
  };
}
