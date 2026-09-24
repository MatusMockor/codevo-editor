// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import {
  AGENT_SCRIPT_BUSY_REASON,
  AGENT_SCRIPT_WORKTREE_MISSING_REASON,
  MAX_AGENT_THREAD_SCRIPT_ENTRIES,
  agentScriptRunnerOutcome,
  preferredEntry,
  projectScriptTarget,
  scopedScripts,
  useAgentThreadScripts,
  type AgentThreadScriptOutcome,
  type AgentThreadScriptRunner,
  type AgentThreadScriptTarget,
  type AgentThreadScripts,
  type UseAgentThreadScriptsOptions,
} from "./useAgentThreadScripts";

const WORKSPACE = "/workspace/mono";

describe("useAgentThreadScripts", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentThreadScripts | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps only scripts whose package lives inside the thread repository", () => {
    const runner = runnerWith([
      script("root", "dev", ""),
      script("api", "test", "packages/api"),
      script("web", "build", "packages/web"),
    ]);
    render({ runner, target: target({ repositoryRoot: `${WORKSPACE}/packages/api` }) });

    expect(surface().entries.map((entry) => entry.key)).toEqual(["api"]);
    expect(surface().entries[0]?.detail).toBe("packages/api");
  });

  it("prefers the last script run for the repository, then dev/start/test, then the first entry", () => {
    const runner = runnerWith([
      script("lint", "lint", ""),
      script("test", "test", ""),
      script("dev", "dev", ""),
    ]);
    render({ runner, target: target({ isolation: "in-place" }) });
    expect(surface().preferred?.key).toBe("dev");

    act(() => {
      surface().runScript("lint");
    });

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ key: "lint" }),
      {
        kind: "workspaceRoot",
      },
      WORKSPACE,
    );
    expect(surface().preferred?.key).toBe("lint");
  });

  it("shows the terminal before running and refuses blocked or unknown entries", () => {
    const runner = runnerWith([script("dev", "dev", "")]);
    const onBeforeRun = vi.fn();
    render({ onBeforeRun, runner, target: target({ isolation: "in-place" }) });

    let accepted = false;
    act(() => {
      accepted = surface().runScript("missing");
    });
    expect(accepted).toBe(false);
    expect(onBeforeRun).not.toHaveBeenCalled();

    act(() => {
      accepted = surface().runScript("dev");
    });
    expect(accepted).toBe(true);
    expect(onBeforeRun).toHaveBeenCalledTimes(1);
  });

  it("runs worktree threads through the typed worktree target", () => {
    const runner = runnerWith([script("dev", "dev", "")]);
    render({ runner, target: target({ isolation: "worktree" }) });

    expect(surface().entries[0]?.availability).toEqual({ kind: "available" });
    act(() => {
      surface().runScript("dev");
    });
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ key: "dev" }),
      {
        kind: "agentWorktree",
        threadId: "agt-1",
      },
      WORKSPACE,
    );
  });

  it("blocks a missing worktree and an unavailable runner with their reasons", () => {
    const runner = runnerWith([script("dev", "dev", "")], {
      available: false,
      reason: "Untrusted",
    });
    render({ runner, target: target({ isolation: "in-place", worktreeMissing: true }) });
    expect(surface().entries[0]?.availability).toEqual({ kind: "blocked", reason: "Untrusted" });

    render({
      runner: runnerWith([script("dev", "dev", "")]),
      target: target({ worktreeMissing: true }),
    });
    expect(surface().entries[0]?.availability).toEqual({
      kind: "blocked",
      reason: AGENT_SCRIPT_WORKTREE_MISSING_REASON,
    });
  });

  it("shows a script started elsewhere as running without a stop authority", () => {
    const runner = runnerWith([script("dev", "dev", "")], {
      active: { runId: "run-1", scriptName: "dev", manifestRelativePath: "package.json" },
    });
    render({ runner, target: target({ isolation: "in-place" }) });

    expect(surface().run).toEqual({
      kind: "running",
      key: "dev",
      label: "dev",
      stoppable: false,
      reason: AGENT_SCRIPT_BUSY_REASON,
    });
    expect(surface().entries[0]?.availability).toEqual({
      kind: "blocked",
      reason: AGENT_SCRIPT_BUSY_REASON,
    });
    act(() => {
      surface().runScript("dev");
    });
    expect(runner.run).not.toHaveBeenCalled();
    act(() => surface().stopScript());
    expect(runner.stop).not.toHaveBeenCalled();
  });

  it("stops a script this thread started and drops the authority on a thread switch", () => {
    const idle = runnerWith([script("dev", "dev", "")]);
    render({ runner: idle, target: target({ isolation: "in-place" }) });

    act(() => {
      surface().runScript("dev");
    });
    expect(idle.run).toHaveBeenCalledTimes(1);

    const running = runnerWith([script("dev", "dev", "")], {
      active: { runId: "run-1", scriptName: "dev", manifestRelativePath: "package.json" },
      run: idle.run,
      stop: idle.stop,
    });
    render({ runner: running, target: target({ isolation: "in-place" }) });

    expect(surface().run).toEqual({
      kind: "running",
      key: "dev",
      label: "dev",
      stoppable: true,
      reason: null,
    });
    act(() => surface().stopScript());
    expect(running.stop).toHaveBeenCalledTimes(1);

    render({ runner: running, target: target({ isolation: "in-place", threadId: "agt-2" }) });

    expect(surface().run).toMatchObject({ stoppable: false, reason: AGENT_SCRIPT_BUSY_REASON });
    act(() => surface().stopScript());
    expect(running.stop).toHaveBeenCalledTimes(1);
  });

  it("forgets the stop authority once the run settles", () => {
    const idle = runnerWith([script("dev", "dev", "")]);
    render({ runner: idle, target: target({ isolation: "in-place" }) });
    act(() => {
      surface().runScript("dev");
    });

    const mine = runnerWith([script("dev", "dev", "")], {
      active: { runId: "run-1", scriptName: "dev", manifestRelativePath: "package.json" },
      run: idle.run,
      stop: idle.stop,
    });
    render({ runner: mine, target: target({ isolation: "in-place" }) });
    expect(surface().run).toMatchObject({ stoppable: true });

    render({ runner: idle, target: target({ isolation: "in-place" }) });
    expect(surface().run).toEqual({ kind: "idle" });

    const foreign = runnerWith([script("dev", "dev", "")], {
      active: { runId: "run-2", scriptName: "dev", manifestRelativePath: "package.json" },
      run: idle.run,
      stop: idle.stop,
    });
    render({ runner: foreign, target: target({ isolation: "in-place" }) });

    expect(surface().run).toMatchObject({ stoppable: false });
  });

  it("keeps the exit of a script this thread ran until that script runs again", () => {
    const scripts = [script("hello", "hello", ""), script("lint", "lint", "")];
    const idle = runnerWith(scripts);
    render({ runner: idle, target: target({ isolation: "in-place" }) });
    expect(surface().outcomes.size).toBe(0);

    settle(idle, "hello", "run-1", { kind: "exited", exitCode: 0 });
    expect(surface().outcomes.get("hello")).toEqual({ kind: "exited", exitCode: 0 });

    settle(idle, "lint", "run-2", { kind: "exited", exitCode: 1 });
    expect(surface().outcomes.get("hello")).toEqual({ kind: "exited", exitCode: 0 });
    expect(surface().outcomes.get("lint")).toEqual({ kind: "exited", exitCode: 1 });

    act(() => {
      surface().runScript("hello");
    });
    expect(surface().outcomes.has("hello")).toBe(false);
    expect(surface().outcomes.get("lint")).toEqual({ kind: "exited", exitCode: 1 });
  });

  it("shows an exit only to the thread and workspace that ran the script", () => {
    const idle = runnerWith([script("hello", "hello", "")]);
    render({ runner: idle, target: target({ isolation: "in-place" }) });
    settle(idle, "hello", "run-1", { kind: "exited", exitCode: 0 });

    render({ runner: settled(idle, "hello", "run-1"), target: target({ threadId: "agt-2" }) });
    expect(surface().outcomes.size).toBe(0);

    render({
      runner: settled(idle, "hello", "run-1"),
      target: target({ isolation: "in-place", repositoryRoot: `${WORKSPACE}-other` }),
      workspaceRoot: `${WORKSPACE}-other`,
    });
    expect(surface().entries.map((entry) => entry.key)).toEqual(["hello"]);
    expect(surface().outcomes.size).toBe(0);

    render({ runner: settled(idle, "hello", "run-1"), target: target({ isolation: "in-place" }) });
    expect(surface().outcomes.get("hello")).toEqual({ kind: "exited", exitCode: 0 });
  });

  it("ignores the exit of a script started elsewhere", () => {
    const foreign = runnerWith([script("hello", "hello", "")], {
      active: { runId: "run-9", scriptName: "hello", manifestRelativePath: "package.json" },
    });
    render({ runner: foreign, target: target({ isolation: "in-place" }) });
    render({
      runner: settled(foreign, "hello", "run-9"),
      target: target({ isolation: "in-place" }),
    });

    expect(surface().outcomes.size).toBe(0);
  });

  it("carries the manifest and the package-manager invocation for every entry", () => {
    const pnpm: NodePackageScript = {
      ...script("api", "test", "packages/api"),
      packageManager: "pnpm",
    };
    render({ runner: runnerWith([script("dev", "dev", ""), pnpm]) });

    expect(
      surface().entries.map((entry) => [entry.key, entry.manifestRelativePath, entry.command]),
    ).toEqual([
      ["dev", "package.json", "npm run dev"],
      ["api", "packages/api/package.json", "pnpm run test"],
    ]);
  });

  it("runs project-scope scripts from the workspace root and owns their stop", () => {
    const idle = runnerWith([script("dev", "dev", "")]);
    const project = projectScriptTarget(WORKSPACE);
    render({ runner: idle, target: project });

    expect(surface().entries[0]?.availability).toEqual({ kind: "available" });
    act(() => {
      surface().runScript("dev");
    });
    expect(idle.run).toHaveBeenCalledWith(
      expect.objectContaining({ key: "dev" }),
      { kind: "workspaceRoot" },
      WORKSPACE,
    );

    const running = runnerWith([script("dev", "dev", "")], {
      active: { runId: "run-1", scriptName: "dev", manifestRelativePath: "package.json" },
      run: idle.run,
      stop: idle.stop,
    });
    render({ runner: running, target: projectScriptTarget(WORKSPACE) });
    expect(surface().run).toMatchObject({ stoppable: true });

    render({ runner: running, target: target({ isolation: "in-place" }) });
    expect(surface().run).toMatchObject({ stoppable: false });
  });

  it("keeps the same surface when an equal target is recreated", () => {
    const runner = runnerWith([script("dev", "dev", "")]);
    const onBeforeRun = vi.fn();
    render({ onBeforeRun, runner, target: target({ isolation: "in-place" }) });
    const first = surface();

    render({ onBeforeRun, runner, target: target({ isolation: "in-place" }) });

    expect(surface()).toBe(first);
  });

  it("returns nothing without a target or workspace root", () => {
    render({ runner: runnerWith([script("dev", "dev", "")]), target: null });
    expect(surface().entries).toEqual([]);
    expect(surface().preferred).toBeNull();
  });

  function settle(
    idle: AgentThreadScriptRunner,
    scriptName: string,
    runId: string,
    outcome: AgentThreadScriptOutcome = { kind: "exited", exitCode: 0 },
  ): void {
    const current = target({ isolation: "in-place" });
    render({ runner: idle, target: current });
    act(() => {
      surface().runScript(scriptName);
    });
    const running = runnerWith(idle.scripts, {
      active: { runId, scriptName, manifestRelativePath: "package.json" },
      run: idle.run,
      stop: idle.stop,
    });
    render({ runner: running, target: current });
    render({ runner: settled(idle, scriptName, runId, outcome), target: current });
  }

  function settled(
    idle: AgentThreadScriptRunner,
    scriptName: string,
    runId: string,
    outcome: AgentThreadScriptOutcome = { kind: "exited", exitCode: 0 },
  ): AgentThreadScriptRunner {
    return runnerWith(idle.scripts, {
      run: idle.run,
      stop: idle.stop,
      lastOutcome: { runId, scriptName, manifestRelativePath: "package.json", outcome },
    });
  }

  function render(overrides: Partial<UseAgentThreadScriptsOptions>): void {
    const options: UseAgentThreadScriptsOptions = {
      onBeforeRun: vi.fn(),
      runner: runnerWith([]),
      target: target({}),
      workspaceRoot: WORKSPACE,
      ...overrides,
    };
    act(() => {
      root.render(<Probe {...options} />);
    });
  }

  function surface(): AgentThreadScripts {
    expect(latest).not.toBeNull();
    return latest as AgentThreadScripts;
  }

  function Probe(options: UseAgentThreadScriptsOptions) {
    latest = useAgentThreadScripts(options);
    return null;
  }
});

describe("scopedScripts", () => {
  it("caps the projection and reports truncation", () => {
    const many = Array.from({ length: MAX_AGENT_THREAD_SCRIPT_ENTRIES + 3 }, (_, index) =>
      script(`s${index}`, `s${index}`, ""),
    );
    const scoped = scopedScripts(many, WORKSPACE, WORKSPACE);
    expect(scoped.scripts).toHaveLength(MAX_AGENT_THREAD_SCRIPT_ENTRIES);
    expect(scoped.truncated).toBe(true);
  });

  it("does not match a sibling directory sharing a prefix", () => {
    const scoped = scopedScripts(
      [script("a", "dev", "packages/api"), script("b", "dev", "packages/api-docs")],
      WORKSPACE,
      `${WORKSPACE}/packages/api/`,
    );
    expect(scoped.scripts.map((entry) => entry.key)).toEqual(["a"]);
  });
});

describe("agentScriptRunnerOutcome", () => {
  const identity = {
    runId: "run-1",
    workspaceId: "ws-1",
    manifestRelativePath: "package.json",
    scriptName: "lint",
  };

  it("maps settled task states to the last outcome of the script", () => {
    expect(
      agentScriptRunnerOutcome({ ...identity, status: "exited", sessionId: null, exitCode: 1 }),
    ).toEqual({
      runId: "run-1",
      scriptName: "lint",
      manifestRelativePath: "package.json",
      outcome: { kind: "exited", exitCode: 1 },
    });
    expect(
      agentScriptRunnerOutcome({ ...identity, status: "failed", sessionId: null, message: "boom" })
        ?.outcome,
    ).toEqual({ kind: "failed", message: "boom" });
    expect(
      agentScriptRunnerOutcome({ ...identity, status: "stopped", sessionId: null })?.outcome,
    ).toEqual({ kind: "stopped" });
  });

  it("reports no outcome while a task is pending or absent", () => {
    expect(agentScriptRunnerOutcome(null)).toBeNull();
    expect(
      agentScriptRunnerOutcome({ ...identity, status: "acquiring-terminal", sessionId: null }),
    ).toBeNull();
  });
});

describe("preferredEntry", () => {
  it("falls back to the first entry when nothing matches", () => {
    const entries = [entry("lint"), entry("format")];
    expect(preferredEntry(entries, "gone")?.key).toBe("lint");
    expect(preferredEntry([], null)).toBeNull();
  });

  function entry(name: string) {
    return { key: name, label: name, detail: null, availability: { kind: "available" as const } };
  }
});

function target(overrides: Partial<AgentThreadScriptTarget>): AgentThreadScriptTarget {
  return {
    threadId: "agt-1",
    repositoryRoot: WORKSPACE,
    isolation: "worktree",
    worktreePath: `${WORKSPACE}/.worktrees/agt-1`,
    worktreeMissing: false,
    ...overrides,
  };
}

function script(
  key: string,
  scriptName: string,
  packageRootRelativePath: string,
): NodePackageScript {
  return {
    key,
    manifestRelativePath:
      packageRootRelativePath === "" ? "package.json" : `${packageRootRelativePath}/package.json`,
    packageName: null,
    packageManager: "npm",
    packageRootRelativePath,
    scriptName,
  };
}

function runnerWith(
  scripts: ReadonlyArray<NodePackageScript>,
  options: {
    readonly available?: boolean;
    readonly reason?: string | null;
    readonly active?: AgentThreadScriptRunner["active"];
    readonly run?: AgentThreadScriptRunner["run"];
    readonly stop?: AgentThreadScriptRunner["stop"];
    readonly lastOutcome?: AgentThreadScriptRunner["lastOutcome"];
  } = {},
): AgentThreadScriptRunner {
  return {
    scripts,
    truncated: false,
    available: options.available ?? true,
    unavailableReason: options.reason ?? null,
    active: options.active ?? null,
    run: options.run ?? vi.fn(() => true),
    stop: options.stop ?? vi.fn(),
    lastOutcome: options.lastOutcome ?? null,
  };
}
