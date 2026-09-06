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
  SURFACE_NO_THREAD_REASON,
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
    expect(cards).toHaveLength(3);
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
    ]);
  });

  it("keeps the accessible names, key shortcuts and disabled reasons", () => {
    const onChooseSurface = vi.fn();
    render({ onChooseSurface, thread: null });

    const files = host.querySelector<HTMLButtonElement>('[aria-label="Open Files surface"]');
    expect(files?.getAttribute("aria-keyshortcuts")).toBe("F");
    expect(files?.disabled).toBe(false);
    const diff = host.querySelector<HTMLButtonElement>('[aria-label="Open Diff surface"]');
    expect(diff?.disabled).toBe(true);
    expect(diff?.getAttribute("aria-describedby")).toBe("agent-surface-card-diff");
    expect(host.querySelector("#agent-surface-card-diff")?.textContent).toBe(
      SURFACE_NO_THREAD_REASON,
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
