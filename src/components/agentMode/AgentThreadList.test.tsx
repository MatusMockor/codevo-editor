// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRailEmptyState } from "./agentSidebarPresentation";
import { AgentThreadList, type AgentThreadListProps } from "./AgentThreadList";

describe("AgentThreadList empty state", () => {
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

  it("offers a terminal session import from the no-threads state", () => {
    const onImportTerminalSession = vi.fn();
    render({
      empty: { kind: "noThreads", scopeLabel: null },
      onImportTerminalSession,
    });

    expect(host.textContent).toContain("No threads yet");
    const link = importLink();
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("Import a terminal session…");

    act(() => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onImportTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("keeps the scoped no-threads wording next to the import action", () => {
    render({
      empty: { kind: "noThreads", scopeLabel: "app" },
      onImportTerminalSession: () => undefined,
    });

    expect(host.textContent).toContain("No threads in app yet");
    expect(importLink()).not.toBeNull();
  });

  it("renders no import action when the entry point is not wired", () => {
    render({ empty: { kind: "noThreads", scopeLabel: null } });

    expect(host.textContent).toContain("No threads yet");
    expect(importLink()).toBeNull();
  });

  it("renders no import action without any project", () => {
    render({
      empty: { kind: "noProjects" },
      onImportTerminalSession: () => undefined,
    });

    expect(host.textContent).toContain("No projects yet");
    expect(importLink()).toBeNull();
  });

  function importLink(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(".agent-rail__empty-import");
  }

  function render(overrides: Partial<AgentThreadListProps> & { empty: AgentRailEmptyState }) {
    act(() => root.render(<AgentThreadList {...defaults()} {...overrides} />));
  }
});

function defaults(): AgentThreadListProps {
  return {
    sections: { pinned: [], active: [], archived: [], hiddenArchivedCount: 0 },
    projectLabels: new Map(),
    selectedThreadId: null,
    focusedThreadId: null,
    jumpLabels: new Map(),
    archivedExpanded: false,
    empty: { kind: "noThreads", scopeLabel: null },
    onToggleArchived: () => undefined,
    onShowMoreArchived: () => undefined,
    onSelectThread: () => undefined,
    onTogglePin: () => undefined,
    onThreadMenuCommand: () => undefined,
  };
}
