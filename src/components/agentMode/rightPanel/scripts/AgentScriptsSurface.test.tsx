// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProjectActionRow,
  AgentScriptRow,
} from "../../../../application/rightPanel/agentScriptsSurfaceModel";
import { mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { AgentScriptsSurface, type AgentScriptsSurfaceProps } from "./AgentScriptsSurface";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

const LONG_COMMAND = `npm run lint -- ${"--rule some-long-rule ".repeat(12)}`.trim();

function rows(): ReadonlyArray<AgentScriptRow> {
  return [
    {
      key: "dev",
      name: "dev",
      command: "npm run dev",
      state: { kind: "running", stoppable: true },
      blockedReason: null,
    },
    {
      key: "lint",
      name: "lint",
      command: LONG_COMMAND,
      state: { kind: "exited", exitCode: 1 },
      blockedReason: "Another script is already running",
    },
    { key: "test", name: "test", command: null, state: { kind: "idle" }, blockedReason: null },
  ];
}

function actionRows(): ReadonlyArray<AgentProjectActionRow> {
  return [
    {
      id: "reset",
      label: "Reset dev database",
      detail: "npm run db:migrate && npm run db:seed",
      identity: { package: ".", label: "Reset dev database" },
      state: { kind: "idle" },
      blockedReason: null,
    },
    {
      id: "watch",
      label: "Watch",
      detail: null,
      identity: { package: ".", label: "Watch" },
      state: { kind: "running", stopping: false },
      blockedReason: null,
    },
  ];
}

function props(overrides: Partial<AgentScriptsSurfaceProps> = {}): AgentScriptsSurfaceProps {
  return {
    manifests: [{ relativePath: "package.json", label: "package.json" }],
    selectedManifest: "package.json",
    rows: rows(),
    truncated: false,
    actions: actionRows(),
    configurationAction: "open",
    actionsRunInProjectRoot: false,
    onSelectManifest: () => undefined,
    onReload: () => undefined,
    onRun: () => undefined,
    onStop: () => undefined,
    onShowOutput: () => undefined,
    onRunAction: () => undefined,
    onStopAction: () => undefined,
    onConfigureActions: () => undefined,
    ...overrides,
  };
}

function render(overrides: Partial<AgentScriptsSurfaceProps> = {}): HTMLElement {
  ui = ui ?? mountUi();
  ui.render(<AgentScriptsSurface {...props(overrides)} />);
  return ui.host;
}

function button(host: ParentNode, label: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

describe("AgentScriptsSurface", () => {
  it("shows a single manifest as static text next to Reload", () => {
    const onReload = vi.fn();
    const host = render({ onReload });

    expect(host.querySelector(".cv-scripts__manifest")?.textContent).toBe("package.json");
    expect(host.querySelector('button[aria-haspopup="menu"]')).toBeNull();
    act(() => button(host, "Reload scripts")?.click());
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("picks a manifest from a menu when there are several", () => {
    const onSelectManifest = vi.fn();
    const host = render({
      manifests: [
        { relativePath: "package.json", label: "package.json" },
        { relativePath: "packages/api/package.json", label: "packages/api/package.json" },
      ],
      onSelectManifest,
    });

    const picker = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    expect(picker?.textContent).toBe("package.json");
    expect(picker?.getAttribute("aria-label")).toBe("Package: package.json");
    act(() => picker?.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "package.json",
      "packages/api/package.json",
    ]);
    act(() => items[1]?.click());
    expect(onSelectManifest).toHaveBeenCalledWith("packages/api/package.json");
  });

  it("renders one row per script with run and stop on the leading button", () => {
    const onRun = vi.fn();
    const onStop = vi.fn();
    const host = render({ onRun, onStop });

    const scriptRows = [...host.querySelectorAll('.cv-scripts .cv-script-row[data-kind="script"]')];
    expect(scriptRows).toHaveLength(3);
    expect(scriptRows.map((row) => row.querySelector(".cv-script-row__name")?.textContent)).toEqual(
      ["dev", "lint", "test"],
    );

    act(() => button(host, "Stop dev")?.click());
    expect(onStop).toHaveBeenCalledTimes(1);
    act(() => button(host, "Run test")?.click());
    expect(onRun).toHaveBeenCalledWith("test");
  });

  it("links a running script to its output", () => {
    const onShowOutput = vi.fn();
    const host = render({ onShowOutput });

    const running = button(host, "Stop dev")?.closest(".cv-script-row");
    expect(running?.getAttribute("data-state")).toBe("running");
    expect(running?.querySelector(".cv-status--work")?.textContent).toBe("Running");
    const link = [...(running?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Show output",
    );
    act(() => link?.click());
    expect(onShowOutput).toHaveBeenCalledTimes(1);
  });

  it("keeps a clean exit and its output link on the row after the script ends", () => {
    const onShowOutput = vi.fn();
    const host = render({
      onShowOutput,
      rows: [
        {
          key: "hello",
          name: "hello",
          command: "npm run hello",
          state: { kind: "exited", exitCode: 0 },
          blockedReason: null,
        },
      ],
    });

    const hello = button(host, "Run hello")?.closest(".cv-script-row");
    expect(hello?.getAttribute("data-state")).toBe("exited");
    expect(hello?.querySelector(".cv-status--ok")?.textContent).toBe("Exit 0");
    const link = [...(hello?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Show output",
    );
    act(() => link?.click());
    expect(onShowOutput).toHaveBeenCalledTimes(1);
  });

  it("shows a failing exit in the failure style and keeps the full command in the DOM", () => {
    const host = render();

    const lint = button(host, "Run lint")?.closest(".cv-script-row");
    expect(lint?.querySelector(".cv-status--fail")?.textContent).toBe("Exit 1");
    const command = lint?.querySelector(".cv-script-row__cmd");
    expect(command?.textContent).toBe(LONG_COMMAND);
    expect(command?.getAttribute("title")).toBe(LONG_COMMAND);
    const test = button(host, "Run test")?.closest(".cv-script-row");
    expect(test?.querySelector(".cv-script-row__cmd")).toBeNull();
  });

  it("disables blocked rows with the reason as their title", () => {
    const onRun = vi.fn();
    const host = render({ onRun });

    const lint = button(host, "Run lint");
    expect(lint?.disabled).toBe(true);
    expect(lint?.title).toBe("Another script is already running");
    act(() => lint?.click());
    expect(onRun).not.toHaveBeenCalled();
  });

  it("disables stop for a run this thread does not own", () => {
    const host = render({
      rows: [
        {
          key: "dev",
          name: "dev",
          command: "npm run dev",
          state: { kind: "running", stoppable: false },
          blockedReason: "Another script is already running",
        },
      ],
    });

    expect(button(host, "Stop dev")?.disabled).toBe(true);
    expect(button(host, "Stop dev")?.title).toBe("Another script is already running");
  });

  it("lists project actions with run and stop and an Add action row", () => {
    const onRunAction = vi.fn();
    const onStopAction = vi.fn();
    const onConfigureActions = vi.fn();
    const host = render({ onConfigureActions, onRunAction, onStopAction });

    const group = host.querySelector(".cv-scripts__group");
    expect(group?.textContent).toBe("Project actions");
    expect(group?.querySelector(".cv-scripts__group-hint")).toBeNull();
    act(() => button(host, "Run Reset dev database")?.click());
    expect(onRunAction).toHaveBeenCalledWith({ package: ".", label: "Reset dev database" });
    act(() => button(host, "Stop Watch")?.click());
    expect(onStopAction).toHaveBeenCalledTimes(1);

    const add = host.querySelector<HTMLButtonElement>(".cv-scripts__add");
    expect(add?.textContent).toBe("Add action");
    act(() => add?.click());
    expect(onConfigureActions).toHaveBeenCalledTimes(1);
  });

  it("says project actions run in the project root for a worktree thread", () => {
    const host = render({ actionsRunInProjectRoot: true });
    expect(host.querySelector(".cv-scripts__group-hint")?.textContent).toBe("Runs in project root");

    render({ actionsRunInProjectRoot: false });
    expect(host.querySelector(".cv-scripts__group-hint")).toBeNull();
  });

  it("hides Add action without a configuration action and the group without tasks", () => {
    const host = render({ configurationAction: null, actions: [] });
    expect(host.querySelector(".cv-scripts__add")).toBeNull();
    expect(host.querySelector(".cv-scripts__group")).toBeNull();

    render({ actions: null });
    expect(host.querySelector(".cv-scripts__group")).toBeNull();
  });

  it("explains an empty or truncated script list", () => {
    const host = render({ rows: [], manifests: [], selectedManifest: null, actions: null });
    expect(host.querySelector(".cv-scripts__note")?.textContent).toBe("No package scripts found.");

    render({ truncated: true });
    expect(host.querySelector(".cv-scripts__note")?.textContent).toBe(
      "Only the first scripts are listed.",
    );
  });
});
