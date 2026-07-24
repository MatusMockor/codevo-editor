import { describe, expect, it } from "vitest";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import type { NodePackageTaskState } from "../application/nodePackageTaskLifecycle";
import { presentNodePackageScriptsPanel } from "./NodePackageScriptsPanelModel";

describe("presentNodePackageScriptsPanel", () => {
  it("groups root and nested manifests without losing typed script identities", () => {
    const model = presentNodePackageScriptsPanel({
      available: true,
      pending: false,
      scripts: [
        script("package.json", "", "root", "test"),
        script("apps/web/package.json", "apps/web", "web", "build"),
      ],
      task: null,
      total: 2,
    });

    expect(
      model.groups.map(({ label, manifestRelativePath }) => ({ label, manifestRelativePath })),
    ).toEqual([
      { label: "root", manifestRelativePath: "package.json" },
      { label: "web", manifestRelativePath: "apps/web/package.json" },
    ]);
    expect(model.groups[1]?.rows[0]?.script.key).toBe("apps/web/package.json:build");
  });

  it("marks the exact owner, presents its status, and gates every run while active", () => {
    const task: NodePackageTaskState = {
      ...owner("apps/web/package.json", "build"),
      status: "running",
    };
    const model = presentNodePackageScriptsPanel({
      available: true,
      pending: true,
      scripts: [
        script("package.json", "", null, "build"),
        script("apps/web/package.json", "apps/web", "web", "build"),
      ],
      task,
      total: 7,
    });

    expect(model.running).toBe(true);
    expect(model.shown).toBe(2);
    expect(model.total).toBe(7);
    expect(model.groups.flatMap((group) => group.rows).map((row) => row.canRun)).toEqual([
      false,
      false,
    ]);
    expect(model.groups[1]?.rows[0]).toMatchObject({
      active: true,
      canStop: true,
      status: "Running",
    });
    expect(model.groups[0]?.rows[0]?.active).toBe(false);
  });

  it("keeps unavailable and pending runs disabled and formats terminal states", () => {
    const failed: NodePackageTaskState = {
      ...owner("package.json", "test"),
      message: "spawn failed",
      sessionId: null,
      status: "failed",
    };
    const model = presentNodePackageScriptsPanel({
      available: false,
      pending: false,
      scripts: [script("package.json", "", null, "test")],
      task: failed,
      total: 0,
    });

    expect(model.groups[0]?.rows[0]).toMatchObject({
      active: true,
      canRun: false,
      canStop: false,
      status: "Failed: spawn failed",
    });
    expect(model.total).toBe(1);
  });

  it("keeps the idempotent stop action available while an owner is stopping", () => {
    const stopping: NodePackageTaskState = {
      ...owner("package.json", "test"),
      status: "stopping",
    };
    const model = presentNodePackageScriptsPanel({
      available: true,
      pending: true,
      scripts: [script("package.json", "", null, "test")],
      task: stopping,
      total: 1,
    });

    expect(model.groups[0]?.rows[0]).toMatchObject({
      canStop: true,
      status: "Stopping",
    });
  });

  it("preserves an active owner omitted by refreshed discovery results", () => {
    const task: NodePackageTaskState = {
      ...owner("packages/api/package.json", "dev"),
      status: "running",
    };
    const model = presentNodePackageScriptsPanel({
      available: true,
      pending: false,
      scripts: [],
      task,
      total: 0,
    });

    expect(model.activeTask).toEqual({
      label: "packages/api/package.json · dev",
      status: "Running",
    });
    expect(model.running).toBe(true);
  });
});

function script(
  manifestRelativePath: string,
  packageRootRelativePath: string,
  packageName: string | null,
  scriptName: string,
): NodePackageScript {
  return {
    key: `${manifestRelativePath}:${scriptName}`,
    manifestRelativePath,
    packageManager: "npm",
    packageName,
    packageRootRelativePath,
    scriptName,
  };
}

function owner(manifestRelativePath: string, scriptName: string) {
  return {
    manifestRelativePath,
    runId: "run-1",
    scriptName,
    sessionId: 4,
    workspaceId: "workspace-1",
  } as const;
}
