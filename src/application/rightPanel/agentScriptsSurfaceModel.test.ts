import { describe, expect, it } from "vitest";
import type { VscodeProcessTaskDisplay } from "../../domain/vscodeProcessTasks";
import type { AgentThreadScriptDetailEntry, AgentThreadScripts } from "../useAgentThreadScripts";
import {
  agentProjectActionRows,
  agentScriptManifests,
  agentScriptRows,
  defaultAgentScriptsManifest,
  type AgentProjectActionsSource,
} from "./agentScriptsSurfaceModel";

function entry(
  name: string,
  manifestRelativePath = "package.json",
  availability: AgentThreadScriptDetailEntry["availability"] = { kind: "available" },
): AgentThreadScriptDetailEntry {
  return {
    key: `${manifestRelativePath}:${name}`,
    label: name,
    detail: null,
    availability,
    manifestRelativePath,
    command: `npm run ${name}`,
  };
}

function scripts(overrides: Partial<AgentThreadScripts> = {}): AgentThreadScripts {
  return {
    entries: [],
    preferred: null,
    truncated: false,
    run: { kind: "idle" },
    outcomes: new Map(),
    runScript: () => true,
    stopScript: () => undefined,
    ...overrides,
  };
}

function task(label: string, overrides: Partial<VscodeProcessTaskDisplay> = {}) {
  return {
    package: ".",
    label,
    configRevision: "r1",
    detail: null,
    group: "none",
    source: "tasks.json",
    executable: true,
    dependsOn: [],
    problemMatcher: null,
    ...overrides,
  } satisfies VscodeProcessTaskDisplay;
}

function actions(overrides: Partial<AgentProjectActionsSource> = {}): AgentProjectActionsSource {
  return {
    tasks: [],
    activeLabel: null,
    running: false,
    occupied: false,
    stopping: false,
    unavailable: null,
    ...overrides,
  };
}

describe("agentScriptManifests", () => {
  it("groups manifests with the root package.json first, labelled by relative path", () => {
    const manifests = agentScriptManifests([
      entry("test", "packages/web/package.json"),
      entry("dev"),
      entry("build", "packages/api/package.json"),
      entry("lint"),
    ]);

    expect(manifests).toEqual([
      { relativePath: "package.json", label: "package.json" },
      { relativePath: "packages/api/package.json", label: "packages/api/package.json" },
      { relativePath: "packages/web/package.json", label: "packages/web/package.json" },
    ]);
    expect(defaultAgentScriptsManifest(manifests)).toBe("package.json");
    expect(defaultAgentScriptsManifest([])).toBeNull();
  });
});

describe("agentScriptRows", () => {
  it("shows the running script and the last failing exit code of another script", () => {
    const dev = entry("dev");
    const lint = entry("lint");
    const rows = agentScriptRows(
      scripts({
        entries: [dev, lint, entry("test", "packages/api/package.json")],
        run: { kind: "running", key: dev.key, label: "dev", stoppable: true, reason: null },
        outcomes: new Map([[lint.key, { kind: "exited", exitCode: 1 }]]),
      }),
      "package.json",
    );

    expect(rows.map((row) => [row.name, row.command, row.state])).toEqual([
      ["dev", "npm run dev", { kind: "running", stoppable: true }],
      ["lint", "npm run lint", { kind: "exited", exitCode: 1 }],
    ]);
    expect(rows[1]?.blockedReason).toBe("Another script is already running");
  });

  it("keeps a clean exit, leaves a stop idle, and reports a failed start", () => {
    const lint = entry("lint");
    const clean = agentScriptRows(
      scripts({
        entries: [lint],
        outcomes: new Map([[lint.key, { kind: "exited", exitCode: 0 }]]),
      }),
      "package.json",
    );
    expect(clean[0]?.state).toEqual({ kind: "exited", exitCode: 0 });

    const stopped = agentScriptRows(
      scripts({ entries: [lint], outcomes: new Map([[lint.key, { kind: "stopped" }]]) }),
      "package.json",
    );
    expect(stopped[0]?.state).toEqual({ kind: "idle" });

    const failed = agentScriptRows(
      scripts({
        entries: [lint],
        outcomes: new Map([[lint.key, { kind: "failed", message: "No terminal" }]]),
      }),
      "package.json",
    );
    expect(failed[0]?.state).toEqual({ kind: "failed", message: "No terminal" });
  });

  it("carries the blocked reason of an entry that cannot run", () => {
    const rows = agentScriptRows(
      scripts({
        entries: [entry("dev", "package.json", { kind: "blocked", reason: "Untrusted" })],
      }),
      "package.json",
    );

    expect(rows[0]).toMatchObject({ state: { kind: "idle" }, blockedReason: "Untrusted" });
  });

  it("shows a script started elsewhere as running without stop authority", () => {
    const dev = entry("dev");
    const rows = agentScriptRows(
      scripts({
        entries: [dev],
        run: {
          kind: "running",
          key: dev.key,
          label: "dev",
          stoppable: false,
          reason: "Another script is already running",
        },
      }),
      "package.json",
    );

    expect(rows[0]?.state).toEqual({ kind: "running", stoppable: false });
  });
});

describe("agentProjectActionRows", () => {
  it("lists tasks.json process tasks with their detail and the running one", () => {
    const rows = agentProjectActionRows(
      actions({
        tasks: [
          task("Reset dev database", { detail: "npm run db:migrate && npm run db:seed" }),
          task("Watch", { package: "packages/api" }),
          task("Compound", { executable: false }),
        ],
        activeLabel: "Watch",
        running: true,
      }),
    );

    expect(rows.map((row) => [row.label, row.detail, row.state, row.blockedReason])).toEqual([
      [
        "Reset dev database",
        "npm run db:migrate && npm run db:seed",
        { kind: "idle" },
        "Another action is running",
      ],
      ["Watch", "packages/api", { kind: "running", stopping: false }, null],
      ["Compound", null, { kind: "idle" }, "This action cannot run from here"],
    ]);
    expect(rows[1]?.identity).toEqual({ package: "packages/api", label: "Watch" });
  });

  it("blocks every action while tasks are unavailable", () => {
    const rows = agentProjectActionRows(
      actions({ tasks: [task("Build")], unavailable: "Trust the workspace to run tasks." }),
    );

    expect(rows[0]?.blockedReason).toBe("Trust the workspace to run tasks.");
  });
});
