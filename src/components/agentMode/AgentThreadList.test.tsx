// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("states the no-projects wording without any import action", () => {
    render({ empty: { kind: "noProjects" } });

    expect(host.textContent).toBe("No projects yet");
    expect(host.querySelector("button")).toBeNull();
  });

  it("labels the project section even when no project holds a thread", () => {
    render({ empty: null });

    expect(host.querySelector(".cv-sb-heading")?.textContent).toBe("Projects");
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  });

  function render(overrides: Partial<AgentThreadListProps> & { empty: AgentRailEmptyState }) {
    act(() => root.render(<AgentThreadList {...defaults()} {...overrides} />));
  }
});

function defaults(): AgentThreadListProps {
  return {
    sections: { pinned: [], active: [] },
    projects: [],
    currentProjectRootKey: null,
    projectActions: {
      onToggleCollapsed: () => undefined,
      onToggleShowingAll: () => undefined,
      onNewThread: () => undefined,
      onProjectCommand: () => undefined,
    },
    projectLabels: new Map(),
    selectedThreadId: null,
    markedThreadIds: new Set<string>(),
    focusedThreadId: null,
    jumpLabels: new Map(),
    settledExpanded: false,
    snoozedExpanded: false,
    empty: { kind: "noProjects" },
    onToggleSettled: () => undefined,
    onToggleSnoozed: () => undefined,
    onSelectThread: () => undefined,
    onThreadMenuCommand: () => undefined,
  };
}
