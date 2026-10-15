import { describe, expect, it } from "vitest";
import {
  fileChangeInvalidatesNodePackageScripts,
  fileChangeInvalidatesVscodeProcessTasks,
} from "./agentWorkspaceDiscoveryInvalidation";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

function event(overrides: Partial<WorkspaceFileChangeEvent>): WorkspaceFileChangeEvent {
  return {
    fileKind: "file",
    kind: "modified",
    path: "/root/src/a.ts",
    relativePath: "src/a.ts",
    rootPath: "/root",
    ...overrides,
  };
}

describe("agent workspace discovery invalidation", () => {
  it("invalidates package scripts for package metadata anywhere, rescans and directory moves", () => {
    expect(fileChangeInvalidatesNodePackageScripts(event({}))).toBe(false);
    expect(fileChangeInvalidatesNodePackageScripts(event({ relativePath: "package.json" }))).toBe(
      true,
    );
    expect(
      fileChangeInvalidatesNodePackageScripts(event({ relativePath: "apps\\web\\pnpm-lock.yaml" })),
    ).toBe(true);
    expect(
      fileChangeInvalidatesNodePackageScripts(
        event({ kind: "renamed", previousRelativePath: "package.json", relativePath: "x.json" }),
      ),
    ).toBe(true);
    expect(fileChangeInvalidatesNodePackageScripts(event({ kind: "rescanRequired" }))).toBe(true);
    expect(
      fileChangeInvalidatesNodePackageScripts(event({ fileKind: "directory", kind: "created" })),
    ).toBe(true);
    expect(
      fileChangeInvalidatesNodePackageScripts(event({ fileKind: "directory", kind: "modified" })),
    ).toBe(false);
  });

  it("invalidates VS Code tasks only for the root tasks file, its directory and rescans", () => {
    expect(
      fileChangeInvalidatesVscodeProcessTasks(event({ relativePath: "./.vscode/tasks.json" })),
    ).toBe(true);
    expect(
      fileChangeInvalidatesVscodeProcessTasks(event({ relativePath: "app/.vscode/tasks.json" })),
    ).toBe(false);
    expect(
      fileChangeInvalidatesVscodeProcessTasks(
        event({ fileKind: "directory", kind: "deleted", relativePath: ".vscode/" }),
      ),
    ).toBe(true);
    expect(
      fileChangeInvalidatesVscodeProcessTasks(
        event({ fileKind: "directory", kind: "created", relativePath: "src" }),
      ),
    ).toBe(false);
    expect(fileChangeInvalidatesVscodeProcessTasks(event({ kind: "rescanRequired" }))).toBe(true);
  });
});
