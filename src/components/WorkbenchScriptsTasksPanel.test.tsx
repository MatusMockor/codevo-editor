// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkbenchScriptsTasksPanel,
  type WorkbenchScriptsTasksPanelProps,
} from "./WorkbenchScriptsTasksPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkbenchScriptsTasksPanel", () => {
  it("keeps package scripts and configured process tasks in independent local tabs", () => {
    const props = defaultProps();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => root.render(<WorkbenchScriptsTasksPanel {...props} />));

    expect(tab(host, "Scripts").getAttribute("aria-selected")).toBe("true");
    const scriptsPanel = host.querySelector("#sidebar-scripts-panel");
    const tasksPanel = host.querySelector("#sidebar-tasks-panel");
    expect(scriptsPanel?.classList.contains("sidebar-subview-panel")).toBe(true);
    expect(tasksPanel?.classList.contains("sidebar-subview-panel")).toBe(true);
    expect(scriptsPanel?.hasAttribute("hidden")).toBe(false);
    expect(tasksPanel?.hasAttribute("hidden")).toBe(true);

    act(() => tab(host, "Tasks").click());

    expect(tab(host, "Tasks").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector("#sidebar-scripts-panel")?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector("#sidebar-tasks-panel")?.hasAttribute("hidden")).toBe(false);
    expect(host.textContent).toContain("Configured Tasks");

    const refresh = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Refresh configured tasks"]',
    );
    act(() => refresh?.click());
    expect(props.vscodeProcessTasks.discover).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("uses roving focus and arrow, Home, and End navigation for the tablist", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<WorkbenchScriptsTasksPanel {...defaultProps()} />));

    const scripts = tab(host, "Scripts");
    const tasks = tab(host, "Tasks");
    expect(scripts.tabIndex).toBe(0);
    expect(tasks.tabIndex).toBe(-1);

    scripts.focus();
    act(() => scripts.dispatchEvent(keydown("ArrowRight")));
    expect(document.activeElement).toBe(tasks);
    expect(tasks.getAttribute("aria-selected")).toBe("true");
    expect(tasks.tabIndex).toBe(0);
    expect(scripts.tabIndex).toBe(-1);

    act(() => tasks.dispatchEvent(keydown("Home")));
    expect(document.activeElement).toBe(scripts);
    expect(scripts.getAttribute("aria-selected")).toBe("true");

    act(() => scripts.dispatchEvent(keydown("End")));
    expect(document.activeElement).toBe(tasks);
    expect(tasks.getAttribute("aria-selected")).toBe("true");

    act(() => root.unmount());
  });

  it("reveals a newly active task once without stealing focus or overriding later manual tabs", () => {
    const host = document.createElement("div");
    const outside = document.createElement("input");
    document.body.append(host, outside);
    const root = createRoot(host);
    const props = defaultProps();
    act(() => root.render(<WorkbenchScriptsTasksPanel {...props} />));
    outside.focus();

    const running = {
      ...props,
      vscodeProcessTasks: {
        ...props.vscodeProcessTasks,
        activeLabel: "build",
        occupied: true,
        running: true,
      },
    };
    act(() => root.render(<WorkbenchScriptsTasksPanel {...running} />));

    expect(tab(host, "Tasks").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(outside);

    act(() => tab(host, "Scripts").click());
    expect(tab(host, "Scripts").getAttribute("aria-selected")).toBe("true");
    act(() => root.render(<WorkbenchScriptsTasksPanel {...running} />));
    expect(tab(host, "Scripts").getAttribute("aria-selected")).toBe("true");

    act(() =>
      root.render(
        <WorkbenchScriptsTasksPanel
          {...running}
          vscodeProcessTasks={{
            ...running.vscodeProcessTasks,
            activeLabel: null,
            occupied: false,
            running: false,
          }}
        />,
      ),
    );
    act(() => root.render(<WorkbenchScriptsTasksPanel {...running} />));
    expect(tab(host, "Tasks").getAttribute("aria-selected")).toBe("true");

    act(() => root.unmount());
  });

  it("reveals an already active task when the top-level Scripts view mounts late", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const props = defaultProps();

    act(() =>
      root.render(
        <WorkbenchScriptsTasksPanel
          {...props}
          vscodeProcessTasks={{
            ...props.vscodeProcessTasks,
            activeLabel: "build",
            occupied: true,
            running: true,
          }}
        />,
      ),
    );

    expect(tab(host, "Tasks").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector("#sidebar-scripts-panel")?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector("#sidebar-tasks-panel")?.hasAttribute("hidden")).toBe(false);

    act(() => root.unmount());
  });
});

function tab(host: HTMLElement, name: string): HTMLButtonElement {
  const candidate = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === name,
  );
  if (!candidate) throw new Error(`missing ${name} tab`);
  return candidate;
}

function keydown(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, key });
}

function defaultProps(): WorkbenchScriptsTasksPanelProps {
  return {
    nodePackageScripts: {
      available: true,
      error: null,
      loading: false,
      onOpen: vi.fn(),
      onRefresh: vi.fn(),
      onRun: vi.fn(),
      onStop: vi.fn(),
      pending: false,
      scripts: [],
      task: null,
      total: 0,
      truncated: false,
    },
    vscodeProcessTasks: {
      activeLabel: null,
      configRevision: "sha256:revision",
      currentStep: null,
      diagnostics: [],
      discover: vi.fn(async () => true),
      discovering: false,
      error: null,
      output: [],
      occupied: false,
      problemNotices: [],
      problems: null,
      running: false,
      start: vi.fn(async () => true),
      startAndWait: vi.fn(async () => ({ status: "exited" as const, exitCode: 0 })),
      status: null,
      stop: vi.fn(async () => true),
      stopping: false,
      tasks: [],
      truncated: false,
      unavailable: null,
    },
  };
}
