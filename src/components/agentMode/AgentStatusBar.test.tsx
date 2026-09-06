// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_MODE_STYLE_SHEETS, readAgentModeStyles } from "./agentModeCssTestSupport";
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

  it("counts the threads that need attention in plural and singular", () => {
    render({ attentionCount: 2 });

    expect(host.querySelector(".status-agent-attention")?.textContent).toBe("2 need attention");

    render({ attentionCount: 1 });

    expect(host.querySelector(".status-agent-attention")?.textContent).toBe("1 needs attention");
  });

  it("stays silent when nothing needs attention", () => {
    render({ attentionCount: 0 });

    expect(host.querySelector(".status-agent-attention")).toBeNull();
  });

  it("names the launch of the selected thread only when one is given", () => {
    render({ launchLabel: "opus · accept edits" });

    expect(host.querySelector(".status-agent-launch")?.textContent).toBe("opus · accept edits");

    render({ launchLabel: null });

    expect(host.querySelector(".status-agent-launch")).toBeNull();
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

describe("agent status bar styles", () => {
  it("reads the codevo ladder directly because it renders outside the workbench frame", () => {
    expect(winningValue(".status-bar.status-bar--agent", "background")).toBe("var(--codevo-side)");
    expect(winningValue(".status-bar.status-bar--agent", "border-top")).toBe("0");
    expect(winningValue(".status-bar.status-bar--agent", "color")).toBe("var(--codevo-fg-muted)");
    expect(winningValue(".status-bar.status-bar--agent", "font-size")).toBe(
      "var(--codevo-fs-small)",
    );
    expect(
      winningValue(".status-bar.status-bar--agent span:not(:last-child)", "border-right"),
    ).toBe("0");
    expect(AGENT_STATUS_BAR_CSS).not.toContain("--t3-");
    expect(AGENT_STATUS_BAR_CSS).not.toContain("--agent-");
  });

  it("outranks the base status bar by specificity, not by import order", () => {
    expect(ruleBody(".status-bar--agent")).not.toContain("background:");
    expect(ruleBody(".status-bar--agent")).not.toContain("font-size:");
  });

  it("marks live slots with the ok tone and no glow", () => {
    expect(winningValue(".status-bar--agent .status-agent-dot--live", "box-shadow")).toBe("none");
    expect(winningValue(".status-bar--agent .status-agent-dot--live", "background")).toBe(
      "var(--codevo-ok)",
    );
    expect(winningValue(".status-bar--agent .status-agent-attention", "color")).toBe(
      "var(--codevo-warn)",
    );
    expect(winningValue(".status-bar--agent .status-agent-cli", "font-family")).toBe(
      "var(--codevo-mono)",
    );
  });

  it("declares the whole bar in one stylesheet", () => {
    const sheetsWithChildren = AGENT_MODE_STYLE_SHEETS.filter((sheet) =>
      readSheet(sheet).includes(".status-agent"),
    );
    const sheetsWithBar = AGENT_MODE_STYLE_SHEETS.filter((sheet) =>
      readSheet(sheet).includes(".status-bar--agent"),
    );

    expect(sheetsWithChildren).toEqual(["agentStatusBar.css"]);
    expect(sheetsWithBar).toEqual(["agentModeTokens.css", "agentStatusBar.css"]);
  });
});

const AGENT_STATUS_BAR_CSS = readSheet("agentStatusBar.css");
const AGENT_MODE_CSS = readAgentModeStyles().replace(/\/\*[\s\S]*?\*\//g, "");

function readSheet(sheet: string): string {
  return readFileSync(resolve(import.meta.dirname, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

function ruleBody(selector: string): string {
  return [...AGENT_MODE_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((block) => (block[1] ?? "").split(",").some((part) => part.trim() === selector))
    .map((block) => block[2] ?? "")
    .join("");
}

function winningValue(selector: string, property: string): string {
  const body = ruleBody(selector);
  expect(body, `Missing rule ${selector}`).not.toBe("");
  const values = [
    ...body.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`, "g")),
  ].map((match) => (match[1] ?? "").trim());
  return values[values.length - 1] ?? "";
}

function defaultProps(): AgentStatusBarProps {
  return {
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 3,
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
  };
}
