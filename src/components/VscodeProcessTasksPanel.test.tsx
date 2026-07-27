// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_VSCODE_PROCESS_TASK_RENDERED_STREAM_CODE_UNITS,
  type VscodeProcessTaskOutput,
  type VscodeProcessTaskOutputStream,
} from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksPanelProps } from "./VscodeProcessTasksPanel";
import { VscodeProcessTasksPanel } from "./VscodeProcessTasksPanel";

describe("VscodeProcessTasksPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  const discover = vi.fn(async () => true);
  const configure = vi.fn(async () => true);
  const start = vi.fn(async () => true);
  const stop = vi.fn(async () => true);
  let props: VscodeProcessTasksPanelProps;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    discover.mockClear();
    configure.mockClear();
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
    expect(host.textContent).toContain("Problem matcher: $tsc");
    expect(host.textContent).toContain("Problem matcher: $eslint-stylish");
    expect(host.textContent).toContain("Unsupported shell");
    expect(host.textContent).toContain(
      "Task has an unsupported problemMatcher; output will not create Problems.",
    );
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
          package: ".",
          label: "Build",
          configRevision: "revision-1",
          detail: null,
          group: "build",
          source: ".vscode/tasks.json",
          executable: true,
          dependsOn: ["<script>safe</script>", "B", "C", "hidden command", "hidden env"],
          problemMatcher: null,
        },
      ],
    });

    expect(host.textContent).toContain("Runs after: <script>safe</script>, B, C (+2 more)");
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).not.toContain("hidden command");
    expect(host.textContent).not.toContain("hidden env");
    expect(buttons(/^Run configured task /)).toHaveLength(1);
  });

  it("refreshes and starts the exact selected executable identity", async () => {
    render();

    await click("Refresh configured tasks");
    await click("Run configured task Build");
    rerender({ activeLabel: "Build", occupied: true, running: true, status: "pending" });

    expect(discover).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledExactlyOnceWith({ package: ".", label: "Build" });
    expect(host.querySelector('[aria-label="Active configured task"]')?.textContent).toContain(
      "Build",
    );
  });

  it("starts duplicate labels from their exact package buttons", async () => {
    rerender({
      tasks: [
        {
          package: ".",
          label: "Build",
          configRevision: "root-revision",
          detail: null,
          group: "build",
          source: ".vscode/tasks.json",
          executable: true,
          dependsOn: [],
          problemMatcher: null,
        },
        {
          package: "packages/api",
          label: "Build",
          configRevision: "api-revision",
          detail: null,
          group: "build",
          source: "packages/api/.vscode/tasks.json",
          executable: true,
          dependsOn: [],
          problemMatcher: null,
        },
      ],
    });

    const runButtons = buttons(/^Run configured task Build$/);
    expect(runButtons).toHaveLength(2);
    await act(async () => runButtons[1]!.click());

    expect(start).toHaveBeenCalledExactlyOnceWith({
      package: "packages/api",
      label: "Build",
    });
  });

  it("offers exact create/open configuration actions and respects busy state", async () => {
    rerender({ configurationAction: "create" });
    await click("Create tasks.json");
    expect(configure).toHaveBeenCalledOnce();
    expect(host.querySelector('[aria-label="Open tasks.json"]')).toBeNull();

    rerender({ configurationAction: "open", configuring: true });
    expect(button("Open tasks.json").disabled).toBe(true);
    expect(button("Open tasks.json").textContent).toBe("Opening…");
    expect(button("Refresh configured tasks").disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Opening .vscode/tasks.json…");

    rerender({ configurationAction: null, configuring: false });
    expect(host.querySelector('[aria-label="Create tasks.json"]')).toBeNull();
    expect(host.querySelector('[aria-label="Open tasks.json"]')).toBeNull();
  });

  it("moves focus to the live status while creating and restores it to configuration", () => {
    rerender({ configurationAction: "create" });
    const create = button("Create tasks.json");
    create.focus();

    rerender({ configurationAction: "create", configuring: true });
    expect(create.textContent).toBe("Creating…");
    expect(document.activeElement).toBe(host.querySelector('[role="status"]'));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Creating .vscode/tasks.json…");

    rerender({ configurationAction: "open", configuring: false });
    expect(document.activeElement).toBe(button("Open tasks.json"));
  });

  it("moves focus from a newly disabled Run action to the available Stop action", () => {
    render();
    const run = button("Run configured task Build");
    run.focus();
    expect(document.activeElement).toBe(run);

    rerender({
      activeLabel: "Build",
      diagnostics: [{ severity: "warning", message: "Check task configuration." }],
      output: taskOutput("progress"),
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
      output: taskOutput("<script>safe stdout</script>\n", "plain stderr\n", true),
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
      element.textContent?.includes("Additional task output was truncated."),
    );
    expect(truncation?.style.color).toBe("var(--color-warning)");
    expect(host.textContent).toContain("Additional configured tasks or diagnostics");
    expect(host.textContent).toContain("Tasks could not be refreshed.");
  });

  it("appends only the new owner-scoped stream suffix into one stable text node", () => {
    const identity = Object.freeze({});
    rerender({
      activeLabel: "Build",
      output: taskOutput("prefix", "", false, identity),
      running: true,
      status: "running",
    });
    const stdout = host.querySelector('pre[aria-label="stdout output"]')!;
    const textNode = stdout.firstChild;

    rerender({
      output: taskOutput("prefix-tail", "", false, identity),
    });

    expect(stdout.firstChild).toBe(textNode);
    expect(stdout.childNodes).toHaveLength(1);
    expect(stdout.textContent).toBe("prefix-tail");

    rerender({
      output: taskOutput("replacement", "", false, Object.freeze({})),
    });
    expect(stdout.firstChild).toBe(textNode);
    expect(stdout.textContent).toBe("replacement");
  });

  it("renders only the bounded stream tail instead of placing the retained megabyte in the DOM", () => {
    const hiddenMarker = "hidden-prefix";
    const marker = "visible-tail";
    const retained =
      hiddenMarker +
      "x".repeat(MAX_VSCODE_PROCESS_TASK_RENDERED_STREAM_CODE_UNITS + 64 * 1_024) +
      marker;
    rerender({
      activeLabel: "Build",
      output: taskOutput(retained),
      running: true,
      status: "running",
    });

    const stdout = host.querySelector('pre[aria-label="stdout output"]')!;
    expect(stdout.textContent?.length).toBe(MAX_VSCODE_PROCESS_TASK_RENDERED_STREAM_CODE_UNITS);
    expect(stdout.textContent?.endsWith(marker)).toBe(true);
    expect(stdout.textContent).not.toContain(hiddenMarker);
    expect(host.textContent).toContain(
      "Earlier stdout output is hidden to keep the task panel responsive.",
    );
  });

  it("announces the current owner-safe step and renders escaped output boundaries", () => {
    rerender({
      activeLabel: "All",
      currentStep: { label: "<script>Build</script>", index: 2, total: 3 },
      output: taskOutput(
        "\n--- Step 2 of 3: <script>Build</script> ---\nbuilt\n",
        "\n--- Step 2 of 3: <script>Build</script> ---\n",
      ),
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
      output: taskOutput("pending"),
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
      problemNotices: [],
      problems: null,
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
      output: taskOutput("workspace A output"),
      status: "exited",
    });
    expect(host.textContent).toContain("Private task from workspace A");

    rerender({
      activeLabel: null,
      output: taskOutput(),
      status: null,
      tasks: [
        {
          package: ".",
          label: "Workspace B task",
          configRevision: "revision-2",
          detail: null,
          group: "none",
          source: ".vscode/tasks.json",
          executable: true,
          dependsOn: [],
          problemMatcher: null,
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
      configurationAction: "open",
      configure,
      configuring: false,
      currentStep: null,
      diagnostics: [],
      discover,
      discovering: false,
      error: null,
      output: taskOutput(),
      occupied: false,
      problemNotices: [],
      problems: null,
      running: false,
      start,
      startAndWait: vi.fn(async () => ({ status: "exited" as const, exitCode: 0 })),
      status: null,
      stop,
      stopping: false,
      tasks: [
        {
          package: ".",
          label: "Build",
          configRevision: "revision-1",
          detail: "Compile TypeScript",
          group: "build",
          source: ".vscode/tasks.json",
          executable: true,
          dependsOn: ["Generate", "Typecheck"],
          problemMatcher: "typescript",
        },
        {
          package: ".",
          label: "Lint",
          configRevision: "revision-1",
          detail: null,
          group: "none",
          source: ".vscode/tasks.json",
          executable: false,
          dependsOn: [],
          problemMatcher: "eslint",
        },
        {
          package: ".",
          label: "Unsupported shell",
          configRevision: "revision-1",
          detail: "Task has an unsupported problemMatcher; output will not create Problems.",
          group: "none",
          source: ".vscode/tasks.json",
          executable: false,
          dependsOn: [],
          problemMatcher: null,
        },
      ],
      truncated: false,
      unavailable: null,
    };
  }
});

function taskOutput(
  stdout = "",
  stderr = "",
  truncated = false,
  identity: object = Object.freeze({}),
): VscodeProcessTaskOutput {
  return Object.freeze({
    identity,
    stdout: taskOutputStream(stdout),
    stderr: taskOutputStream(stderr),
    truncated,
  });
}

function taskOutputStream(text: string): VscodeProcessTaskOutputStream {
  return Object.freeze({
    chunkCount: text.length === 0 ? 0 : 1,
    codeUnits: text.length,
    tail: text.length === 0 ? null : Object.freeze({ previous: null, text }),
  });
}
