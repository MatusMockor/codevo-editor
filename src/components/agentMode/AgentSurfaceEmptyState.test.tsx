// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAgentModeStyles } from "./agentModeCssTestSupport";
import { AgentSurfaceEmptyState, type AgentSurfaceEmptyStateProps } from "./AgentSurfaceEmptyState";
import { AGENT_SURFACE_HOTKEYS } from "./agentSurfaceHotkeys";
import {
  NO_AGENT_SURFACE_SCOPE,
  SURFACE_FILES_NO_PROJECT_DESCRIPTION,
  SURFACE_FILES_PROJECT_DESCRIPTION,
  SURFACE_FILES_UNTRUSTED_DESCRIPTION,
  SURFACE_NO_PROJECT_REASON,
  SURFACE_REMOTE_CAPABILITIES_DESCRIPTION,
  SURFACE_REMOTE_NO_PROJECT_DESCRIPTION,
} from "./agentSurfacePolicy";
import { surfaceRepositoryScope, surfaceThreadView } from "./agentSurfaceTestFixtures";

describe("AgentSurfaceEmptyState", () => {
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

  it("lays every card out as title row, description and a corner key hint", () => {
    render();

    const cards = Array.from(host.querySelectorAll<HTMLButtonElement>(".agent-surface-card"));
    expect(cards).toHaveLength(4);
    expect(host.querySelector(".agent-surface-card__top")).toBeNull();
    for (const card of cards) {
      expect(Array.from(card.children).map((child) => child.className)).toEqual([
        "agent-surface-card__title",
        "agent-surface-card__description",
        "agent-surface-card__key",
      ]);
      const icon = card.querySelector(".agent-surface-card__icon svg");
      expect(icon?.getAttribute("width")).toBe("16");
      expect(
        card.querySelector(".agent-surface-card__title .agent-surface-card__label"),
      ).not.toBeNull();
    }
    expect(
      Array.from(host.querySelectorAll(".agent-surface-card__key")).map((key) => key.textContent),
    ).toEqual([
      AGENT_SURFACE_HOTKEYS.files,
      AGENT_SURFACE_HOTKEYS.diff,
      AGENT_SURFACE_HOTKEYS.terminal,
      AGENT_SURFACE_HOTKEYS.history,
    ]);
  });

  it("keeps the accessible names, key shortcuts and disabled reasons", () => {
    const onChooseSurface = vi.fn();
    render({ onChooseSurface, thread: null, scope: { kind: "none" } });

    const files = host.querySelector<HTMLButtonElement>('[aria-label="Open Files surface"]');
    expect(files?.getAttribute("aria-keyshortcuts")).toBe("F");
    expect(files?.disabled).toBe(false);
    const diff = host.querySelector<HTMLButtonElement>('[aria-label="Open Diff surface"]');
    expect(diff?.disabled).toBe(true);
    expect(diff?.getAttribute("aria-describedby")).toBe("agent-surface-card-diff");
    expect(host.querySelector("#agent-surface-card-diff")?.textContent).toBe(
      SURFACE_NO_PROJECT_REASON,
    );

    act(() => files?.click());
    expect(onChooseSurface).toHaveBeenCalledWith("files");
  });

  it("describes the Files card by the rail scope when no thread is selected", () => {
    render({ thread: null, scope: surfaceRepositoryScope() });
    expect(filesDescription()).toBe(SURFACE_FILES_PROJECT_DESCRIPTION);
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Open Files surface"]')?.disabled,
    ).toBe(false);

    render({
      thread: null,
      scope: {
        kind: "untrusted",
        projectRootKey: "/workspace/app",
        repositoryRoot: "/workspace/app",
      },
    });
    expect(filesDescription()).toBe(SURFACE_FILES_UNTRUSTED_DESCRIPTION);

    render({ thread: null, scope: NO_AGENT_SURFACE_SCOPE });
    expect(filesDescription()).toBe(SURFACE_FILES_NO_PROJECT_DESCRIPTION);
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Open Files surface"]')?.disabled,
    ).toBe(false);
  });

  it("shows only supported server actions with one capability explanation", () => {
    const local = surfaceThreadView();
    const onChooseSurface = vi.fn();
    render({
      thread: {
        ...local,
        thread: { ...local.thread, threadId: "remote-thread:server:conversation" },
      },
      onChooseSurface,
    });
    expect(host.querySelectorAll(".agent-surface-card")).toHaveLength(1);
    expect(host.querySelector('[aria-label="Open Diff surface"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      SURFACE_REMOTE_CAPABILITIES_DESCRIPTION,
    );
    expect(host.querySelectorAll(".agent-surface-card__reason")).toHaveLength(0);
    expect(host.textContent).toContain("Check the server connection");
    expect(host.textContent).not.toContain("not supported in the editor");
    act(() => {
      for (const key of ["f", "t", "h", "d"])
        host
          .querySelector('[role="group"]')
          ?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    expect(onChooseSurface.mock.calls).toEqual([["diff"]]);
  });

  it("does not offer local tools or project changes for a server draft", () => {
    const onChooseSurface = vi.fn();
    render({ thread: null, remote: true, onChooseSurface });
    expect(host.querySelectorAll(".agent-surface-card")).toHaveLength(0);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      SURFACE_REMOTE_NO_PROJECT_DESCRIPTION,
    );
    expect(host.textContent).not.toContain("not supported in the editor");
    expect(host.textContent).not.toContain("Select a server conversation");
    act(() =>
      host
        .querySelector('[role="group"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true })),
    );
    expect(onChooseSurface).not.toHaveBeenCalled();
  });

  function filesDescription(): string {
    return (
      host.querySelector('[aria-label="Open Files surface"] .agent-surface-card__description')
        ?.textContent ?? ""
    );
  }

  function render(overrides: Partial<AgentSurfaceEmptyStateProps> = {}): void {
    act(() => root.render(<AgentSurfaceEmptyState {...defaultProps()} {...overrides} />));
  }
});

describe("surface chooser styles", () => {
  const css = readAgentModeStyles();

  it("stacks raised cards in one column no wider than 320 px", () => {
    expect(cssRule(css, ".agent-surface-empty__inner {")).toContain("max-width: 320px");
    expect(cssRule(css, ".agent-surface-empty__cards {")).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );

    const card = cssRule(css, ".agent-surface-card {");
    expect(card).toContain("position: relative");
    expect(card).toContain("background: var(--codevo-raised)");
    expect(card).toContain("box-shadow: var(--codevo-shadow-card)");
    expect(card).toContain("border-radius: var(--agent-radius-lg)");
    expect(card).toContain("border: 0");
    expect(cssRule(css, ".agent-surface-card:hover:not(:disabled) {")).toContain(
      "background: var(--codevo-hover)",
    );
    expect(cssRule(css, ".agent-surface-card:disabled {")).toContain("background: transparent");
  });

  it("pins the key hint to the top-right corner", () => {
    const key = cssRule(css, ".agent-surface-card__key {");
    expect(key).toContain("position: absolute");
    expect(key).toContain("top: 12px");
    expect(key).toContain("right: 12px");
    expect(key).toContain("background: var(--codevo-hover)");
    expect(key).not.toContain("border:");
  });
});

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `Missing CSS selector ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("{", start);
  const end = source.indexOf("}", bodyStart);
  expect(end).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart + 1, end);
}

function defaultProps(): AgentSurfaceEmptyStateProps {
  return {
    thread: surfaceThreadView(),
    scope: surfaceRepositoryScope(),
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
    onChooseSurface: () => undefined,
  };
}
