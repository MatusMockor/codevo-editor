// @vitest-environment jsdom

import { act } from "react";
import type { AgentThreadView } from "../../../../application/agentThreadPorts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentThreadScriptDetailEntry,
  AgentThreadScripts,
} from "../../../../application/useAgentThreadScripts";
import { mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { createVscodeProcessTaskOutput } from "../../../../domain/vscodeProcessTasks";
import type { VscodeProcessTasksPanelProps } from "../../../VscodeProcessTasksPanel";
import type { AgentScriptsChrome } from "../../agentWorkbenchChrome";
import { WithRightPanelContext, rightPanelTestContext } from "../agentRightPanelTestSupport";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import { AgentScriptsSurfaceContainer } from "./AgentScriptsSurfaceContainer";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function entry(name: string, manifestRelativePath: string): AgentThreadScriptDetailEntry {
  return {
    key: `${manifestRelativePath}:${name}`,
    label: name,
    detail: null,
    availability: { kind: "available" },
    manifestRelativePath,
    command: `npm run ${name}`,
  };
}

function scripts(overrides: Partial<AgentThreadScripts> = {}): AgentThreadScripts {
  const dev = entry("dev", "package.json");
  return {
    entries: [entry("test", "packages/api/package.json"), dev],
    preferred: dev,
    truncated: false,
    run: { kind: "running", key: dev.key, label: "dev", stoppable: true, reason: null },
    outcomes: new Map(),
    runScript: vi.fn(() => true),
    stopScript: vi.fn(),
    ...overrides,
  };
}

function processTasks(): VscodeProcessTasksPanelProps {
  return {
    activeLabel: null,
    configRevision: "r1",
    currentStep: null,
    diagnostics: [],
    discovering: false,
    error: null,
    output: createVscodeProcessTaskOutput(),
    occupied: false,
    problemNotices: [],
    problems: null,
    running: false,
    status: null,
    stopping: false,
    tasks: [
      {
        package: ".",
        label: "Seed",
        configRevision: "r1",
        detail: "npm run db:seed",
        group: "none",
        source: "tasks.json",
        executable: true,
        dependsOn: [],
        problemMatcher: null,
      },
    ],
    truncated: false,
    unavailable: null,
    discover: vi.fn(async () => true),
    start: vi.fn(async () => true),
    startAndWait: vi.fn(async () => null),
    stop: vi.fn(async () => true),
    configurationAction: "open",
    configuring: false,
    configure: vi.fn(async () => true),
  };
}

function chrome(tasks: VscodeProcessTasksPanelProps | null): AgentScriptsChrome {
  return {
    vscodeProcessTasks: tasks,
    openScriptTerminal: vi.fn(),
    refreshScripts: vi.fn(),
  };
}

function render(
  value: AgentThreadScripts | null,
  scriptsChrome: AgentScriptsChrome | null,
  thread: AgentThreadView | null = null,
) {
  ui = ui ?? mountUi();
  ui.render(
    <WithRightPanelContext value={rightPanelTestContext({ scripts: value, scriptsChrome, thread })}>
      <AgentScriptsSurfaceContainer />
    </WithRightPanelContext>,
  );
  return ui.host;
}

function button(host: ParentNode, label: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

describe("AgentScriptsSurfaceContainer", () => {
  it("opens on the root manifest and wires scripts to the thread surface and chrome", () => {
    const surface = scripts();
    const scriptsChrome = chrome(null);
    const host = render(surface, scriptsChrome);

    expect(host.querySelector(".cv-scripts__manifest")?.textContent).toBe("package.json");
    act(() => button(host, "Stop dev")?.click());
    expect(surface.stopScript).toHaveBeenCalledTimes(1);
    const showOutput = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Show output",
    );
    act(() => showOutput?.click());
    expect(scriptsChrome.openScriptTerminal).toHaveBeenCalledTimes(1);
    act(() => button(host, "Reload scripts")?.click());
    expect(scriptsChrome.refreshScripts).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".cv-scripts__group")).toBeNull();
  });

  it("keeps the exit of a finished script with a link to its output", () => {
    const scriptsChrome = chrome(null);
    const host = render(
      scripts({
        run: { kind: "idle" },
        outcomes: new Map([["package.json:dev", { kind: "exited", exitCode: 0 }]]),
      }),
      scriptsChrome,
    );

    const dev = button(host, "Run dev")?.closest(".cv-script-row");
    expect(dev?.querySelector(".cv-status--ok")?.textContent).toBe("Exit 0");
    const showOutput = [...(dev?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Show output",
    );
    act(() => showOutput?.click());
    expect(scriptsChrome.openScriptTerminal).toHaveBeenCalledTimes(1);
  });

  it("switches to another manifest and runs its scripts", () => {
    const surface = scripts({ run: { kind: "idle" } });
    const host = render(surface, chrome(null));

    act(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click());
    const api = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === "packages/api/package.json",
    );
    act(() => api?.click());
    act(() => button(host, "Run test")?.click());

    expect(surface.runScript).toHaveBeenCalledWith("packages/api/package.json:test");
  });

  it("runs, stops and configures project actions through the process tasks", () => {
    const tasks = processTasks();
    const host = render(scripts({ run: { kind: "idle" } }), chrome(tasks));

    act(() => button(host, "Run Seed")?.click());
    expect(tasks.start).toHaveBeenCalledWith({ package: ".", label: "Seed" });
    act(() => host.querySelector<HTMLButtonElement>(".cv-scripts__add")?.click());
    expect(tasks.configure).toHaveBeenCalledTimes(1);
  });

  it("marks project actions as running in the project root only for a worktree thread", () => {
    const worktree = surfaceThreadView();
    const host = render(scripts({ run: { kind: "idle" } }), chrome(processTasks()), worktree);
    expect(host.querySelector(".cv-scripts__group-hint")?.textContent).toBe("Runs in project root");

    render(
      scripts({ run: { kind: "idle" } }),
      chrome(processTasks()),
      surfaceThreadView({
        thread: {
          ...worktree.thread,
          target: { ...worktree.thread.target, isolation: "in-place", worktreePath: null },
        },
      }),
    );
    expect(host.querySelector(".cv-scripts__group-hint")).toBeNull();
  });

  it("explains when scripts are unavailable", () => {
    const host = render(null, chrome(null));
    expect(host.textContent).toBe("Scripts are unavailable here.");
  });
});
