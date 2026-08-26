// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import {
  AGENT_SCRIPT_BUSY_REASON,
  AGENT_SCRIPT_WORKTREE_MISSING_REASON,
  MAX_AGENT_THREAD_SCRIPT_ENTRIES,
  preferredEntry,
  scopedScripts,
  useAgentThreadScripts,
  type AgentThreadScriptRunner,
  type AgentThreadScriptTarget,
  type AgentThreadScriptsSurface,
  type UseAgentThreadScriptsOptions,
} from "./useAgentThreadScripts";

const WORKSPACE = "/workspace/mono";

describe("useAgentThreadScripts", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentThreadScriptsSurface | null;

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

  it("returns nothing without a target or workspace root", () => {
    render({ runner: runnerWith([script("dev", "dev", "")]), target: null });
    expect(surface().entries).toEqual([]);
    expect(surface().preferred).toBeNull();
  });

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

  function surface(): AgentThreadScriptsSurface {
    expect(latest).not.toBeNull();
    return latest as AgentThreadScriptsSurface;
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
  };
}
