// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VscodeProcessTasksPanelProps } from "./VscodeProcessTasksPanel";
import { VscodeProcessTasksPanel } from "./VscodeProcessTasksPanel";

describe("VscodeProcessTasksPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  const discover = vi.fn(async () => true);
  const start = vi.fn(async () => true);
  const stop = vi.fn(async () => true);
  let props: VscodeProcessTasksPanelProps;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    discover.mockClear();
    start.mockClear();
    stop.mockClear();
    props = defaultProps();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders only bounded display metadata and Run only for executable tasks", () => {
    render();

    expect(host.textContent).toContain("Build");
    expect(host.textContent).toContain("Compile TypeScript");
    expect(host.textContent).toContain("Runs after: Generate, Typecheck");
    expect(host.textContent).toContain("build · .vscode/tasks.json");
    expect(host.textContent).toContain("Unsupported shell");
    expect(host.textContent).toContain("No group · .vscode/tasks.json");
    expect(buttons(/^Run configured task /)).toHaveLength(1);
    expect(button("Run configured task Build").type).toBe("button");
    expect(host.textContent).not.toContain("node --run build");
    expect(host.textContent).not.toContain("NODE_ENV");
  });

  it("bounds dependency metadata without interpreting it as markup or execution data", () => {
    rerender({
      tasks: [
        {
          label: "Build",
          detail: null,
          group: "build",
          source: ".vscode/tasks.json",
          executable: true,
          dependsOn: ["<script>safe</script>", "B", "C", "hidden command", "hidden env"],
        },
      ],
    });

    expect(host.textContent).toContain("Runs after: <script>safe</script>, B, C (+2 more)");
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).not.toContain("hidden command");
    expect(host.textContent).not.toContain("hidden env");
    expect(buttons(/^Run configured task /)).toHaveLength(1);
  });

  it("refreshes and starts the exact selected executable label", async () => {
    render();

    await click("Refresh configured tasks");
    await click("Run configured task Build");
    rerender({ activeLabel: "Build", occupied: true, running: true, status: "pending" });

    expect(discover).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledExactlyOnceWith("Build");
    expect(host.querySelector('[aria-label="Active configured task"]')?.textContent).toContain(
      "Build",
    );
  });

  it("moves focus from a newly disabled Run action to the available Stop action", () => {
    render();
    const run = button("Run configured task Build");
    run.focus();
    expect(document.activeElement).toBe(run);

    rerender({
      activeLabel: "Build",
      diagnostics: [{ severity: "warning", message: "Check task configuration." }],
      output: [{ kind: "data", stream: "stdout", data: "progress" }],
      running: true,
      status: "running",
    });

    expect(run.disabled).toBe(true);
    expect(run.type).toBe("button");
    expect(document.activeElement).toBe(button("Stop configured task"));
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
  });

  it("uses one status live region and keeps passive output and diagnostics non-live", () => {
    rerender({
      activeLabel: "Build",
      diagnostics: [
        { severity: "warning", message: "Unknown presentation option." },
        { severity: "error", message: "Task label is duplicated." },
      ],
      error: "Tasks could not be refreshed.",
      output: [
        { kind: "data", stream: "stdout", data: "<script>safe stdout</script>\n" },
        { kind: "data", stream: "stderr", data: "plain stderr\n" },
        { kind: "truncated" },
      ],
      running: true,
      status: "running",
      truncated: true,
    });

    expect(host.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(host.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Tasks could not be refreshed.",
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="log"]')).toBeNull();
    expect(host.querySelector('pre[aria-label="stdout output"]')?.textContent).toContain(
      "<script>safe stdout</script>",
    );
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector('pre[aria-label="stderr output"]')?.textContent).toBe(
      "plain stderr\n",
    );
    const stdout = host.querySelector<HTMLElement>('pre[aria-label="stdout output"]');
    expect(stdout?.style.background).toBe("var(--color-surface)");
    expect(stdout?.closest("div")?.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
    const truncation = [...host.querySelectorAll("p")].find((element) =>
      element.textContent?.includes("Earlier task output was truncated."),
    );
    expect(truncation?.style.color).toBe("var(--color-warning)");
    expect(host.textContent).toContain("Additional configured tasks or diagnostics");
    expect(host.textContent).toContain("Tasks could not be refreshed.");
  });

  it("announces the current owner-safe step and renders escaped output boundaries", () => {
    rerender({
      activeLabel: "All",
      currentStep: { label: "<script>Build</script>", index: 2, total: 3 },
      output: [
        { kind: "step", label: "<script>Build</script>", index: 2, total: 3 },
        { kind: "data", stream: "stdout", data: "built\n" },
      ],
      running: true,
      status: "running",
    });

    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Step 2 of 3: <script>Build</script>",
    );
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector('pre[aria-label="stdout output"]')?.textContent).toContain(
      "--- Step 2 of 3: <script>Build</script> ---",
    );
    expect(host.querySelector('pre[aria-label="stdout output"]')?.textContent).toContain("built");
    expect(host.querySelector('pre[aria-label="stderr output"]')?.textContent).toContain(
      "--- Step 2 of 3: <script>Build</script> ---",
    );
    expect(host.querySelector('[aria-label="Active configured task"]')?.textContent).toContain(
      "All",
    );
  });

  it("offers Stop while pending/running and disables it while stopping", async () => {
    rerender({ activeLabel: "Build", occupied: true, running: true, status: "pending" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Starting");
    expect(button("Refresh configured tasks").disabled).toBe(true);
    expect(button("Run configured task Build").disabled).toBe(true);
    const pendingStop = button("Stop configured task");
    pendingStop.focus();
    expect(document.activeElement).toBe(pendingStop);

    rerender({
      activeLabel: "Build",
      occupied: true,
      output: [{ kind: "data", stream: "stdout", data: "pending" }],
      running: true,
      status: "pending",
    });
    expect(document.activeElement).toBe(pendingStop);
    await click("Stop configured task");
    expect(stop).toHaveBeenCalledOnce();

    rerender({
      activeLabel: "Build",
      occupied: true,
      running: false,
      status: "running",
      stopping: true,
    });
    const stopping = button("Stopping configured task");
    expect(stopping.disabled).toBe(true);
    expect(stopping.textContent).toBe("Stopping…");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Stopping");
    expect(document.activeElement).toBe(host.querySelector('[role="status"]'));

    rerender({
      activeLabel: "Build",
      occupied: false,
      running: false,
      status: "stopped",
      stopping: false,
    });
    expect(host.querySelector('[aria-label="Stop configured task"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("stopped");
    expect(document.activeElement).toBe(button("Run configured task Build"));
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("false");
  });

  it("disables execution and refresh when unavailable without hiding diagnostics", () => {
    rerender({
      diagnostics: [{ severity: "error", message: "Invalid task configuration." }],
      unavailable: "Trust this workspace to run configured tasks.",
    });

    expect(button("Refresh configured tasks").disabled).toBe(true);
    expect(button("Run configured task Build").disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Trust this workspace to run configured tasks.",
    );
    expect(host.textContent).toContain("Invalid task configuration.");
  });

  it("shows an accessible empty state without inventing execution controls", () => {
    rerender({ tasks: [] });

    expect(host.textContent).toContain("No configured process tasks found.");
    expect(buttons(/^Run configured task /)).toHaveLength(0);
    expect(host.querySelector('[aria-label="Stop configured task"]')).toBeNull();
  });

  it("never retains an active label across an owner-filtered workspace switch", () => {
    rerender({
      activeLabel: "Private task from workspace A",
      output: [{ kind: "data", stream: "stdout", data: "workspace A output" }],
      status: "exited",
    });
    expect(host.textContent).toContain("Private task from workspace A");

    rerender({
      activeLabel: null,
      output: [],
      status: null,
      tasks: [
        {
          label: "Workspace B task",
          detail: null,
          group: "none",
          source: ".vscode/tasks.json",
          executable: true,
          dependsOn: [],
        },
      ],
    });

    expect(host.textContent).not.toContain("Private task from workspace A");
    expect(host.textContent).not.toContain("workspace A output");
    expect(host.querySelector('[aria-label="Active configured task"]')).toBeNull();
  });

  function render() {
    act(() => root.render(<VscodeProcessTasksPanel {...props} />));
  }

  function rerender(overrides: Partial<VscodeProcessTasksPanelProps>) {
    props = { ...props, ...overrides };
    render();
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  function button(label: string): HTMLButtonElement {
    const match = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!match) throw new Error(`Missing button: ${label}`);
    return match;
  }

  function buttons(label: RegExp): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].filter((candidate) =>
      label.test(candidate.getAttribute("aria-label") ?? ""),
    );
  }

  function defaultProps(): VscodeProcessTasksPanelProps {
    return {
      activeLabel: null,
      configRevision: "revision-1",
      currentStep: null,
      diagnostics: [],
      discover,
      discovering: false,
      error: null,
      output: [],
      occupied: false,
      running: false,
      start,
      startAndWait: vi.fn(async () => ({ status: "exited" as const, exitCode: 0 })),
      status: null,
      stop,
      stopping: false,
      tasks: [
        {
          label: "Build",
          detail: "Compile TypeScript",
          group: "build",
          source: ".vscode/tasks.json",
          executable: true,
          dependsOn: ["Generate", "Typecheck"],
        },
        {
          label: "Unsupported shell",
          detail: null,
          group: "none",
          source: ".vscode/tasks.json",
          executable: false,
          dependsOn: [],
        },
      ],
      truncated: false,
      unavailable: null,
    };
  }
});
