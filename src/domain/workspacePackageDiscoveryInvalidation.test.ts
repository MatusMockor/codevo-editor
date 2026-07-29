import { describe, expect, it } from "vitest";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";
import { workspaceFileChangeInvalidatesPackageDiscovery } from "./workspacePackageDiscoveryInvalidation";

describe("workspace package discovery invalidation", () => {
  it.each([
    "package.json",
    "./package.json",
    "packages/api/package.json",
    "packages\\api\\package.json",
    "pnpm-workspace.yaml",
    ".gitignore",
    "packages/.gitignore",
    ".ignore",
    "packages/.ignore",
    ".git/info/exclude",
  ])("invalidates package topology changes at %s", (relativePath) => {
    expect(workspaceFileChangeInvalidatesPackageDiscovery(event({ relativePath }))).toBe(true);
  });

  it("invalidates a rename when either side is a package topology file", () => {
    expect(
      workspaceFileChangeInvalidatesPackageDiscovery(
        event({
          kind: "renamed",
          previousRelativePath: "packages/api/package.json",
          relativePath: "packages/api/package.json.old",
        }),
      ),
    ).toBe(true);
    expect(
      workspaceFileChangeInvalidatesPackageDiscovery(
        event({
          kind: "renamed",
          previousRelativePath: "pnpm-workspace.yaml.old",
          relativePath: "pnpm-workspace.yaml",
        }),
      ),
    ).toBe(true);
  });

  it("conservatively invalidates a created directory that may be a pre-populated subtree", () => {
    expect(
      workspaceFileChangeInvalidatesPackageDiscovery(
        event({
          fileKind: "directory",
          kind: "created",
          relativePath: "packages/api",
        }),
      ),
    ).toBe(true);
  });

  it("invalidates directory deletion and rename because they can hide package manifests", () => {
    expect(
      workspaceFileChangeInvalidatesPackageDiscovery(
        event({
          fileKind: "directory",
          kind: "deleted",
          relativePath: "packages/api",
        }),
      ),
    ).toBe(true);
    expect(
      workspaceFileChangeInvalidatesPackageDiscovery(
        event({
          fileKind: "directory",
          kind: "renamed",
          previousRelativePath: "packages/api",
          relativePath: "archive/api",
        }),
      ),
    ).toBe(true);
  });

  it("invalidates explicit watcher rescans", () => {
    expect(
      workspaceFileChangeInvalidatesPackageDiscovery(
        event({ kind: "rescanRequired", relativePath: "" }),
      ),
    ).toBe(true);
  });

  it.each([
    "src/routes.ts",
    "packages/api/src/index.ts",
    "tsconfig.json",
    "packages/api/tsconfig.build.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "node_modules/example/package.json",
    "dist/package.json",
    "vendor/example/package.json",
    "packages/api/coverage/package.json",
  ])("does not invalidate for non-topology file %s", (relativePath) => {
    expect(workspaceFileChangeInvalidatesPackageDiscovery(event({ relativePath }))).toBe(false);
  });

  it("keeps a bounded excluded-directory churn hot path free of package rescans", () => {
    const excludedRoots = ["node_modules", "vendor", "dist", "build", "coverage", "target"];
    const changes = Array.from({ length: 2_000 }, (_, index) =>
      event({
        fileKind: "directory",
        kind: ["created", "deleted", "renamed"][index % 3] as "created" | "deleted" | "renamed",
        previousRelativePath:
          index % 3 === 2
            ? `${excludedRoots[index % excludedRoots.length]}/generated-old-${index}`
            : null,
        relativePath: `${excludedRoots[index % excludedRoots.length]}/generated-${index}`,
      }),
    );

    expect(changes.filter(workspaceFileChangeInvalidatesPackageDiscovery)).toHaveLength(0);
  });

  it.each([
    "node_modules/pkg",
    "vendor/example",
    "dist/chunk",
    ".git/objects/aa",
    "packages/api/coverage/html",
  ])("ignores create, delete, and rename churn inside excluded tree %s", (relativePath) => {
    for (const kind of ["created", "deleted", "renamed"] as const) {
      expect(
        workspaceFileChangeInvalidatesPackageDiscovery(
          event({
            fileKind: "directory",
            kind,
            previousRelativePath: kind === "renamed" ? `${relativePath}-old` : null,
            relativePath,
          }),
        ),
      ).toBe(false);
    }
  });

  it("invalidates a directory moved out of an excluded tree", () => {
    expect(
      workspaceFileChangeInvalidatesPackageDiscovery(
        event({
          fileKind: "directory",
          kind: "renamed",
          previousRelativePath: "node_modules/api",
          relativePath: "packages/api",
        }),
      ),
    ).toBe(true);
  });

  it("remains intentionally conservative for delete and rename outside excluded trees", () => {
    for (const change of [
      event({
        fileKind: "directory",
        kind: "created",
        relativePath: "src/generated",
      }),
      event({
        fileKind: "directory",
        kind: "deleted",
        relativePath: "src/generated",
      }),
      event({
        fileKind: "directory",
        kind: "renamed",
        previousRelativePath: "docs/reference",
        relativePath: "archive/reference",
      }),
    ]) {
      expect(workspaceFileChangeInvalidatesPackageDiscovery(change)).toBe(true);
    }
  });

  it("invalidates root Git metadata topology because it controls nested ignore semantics", () => {
    expect(
      workspaceFileChangeInvalidatesPackageDiscovery(
        event({
          fileKind: "directory",
          kind: "deleted",
          relativePath: ".git",
        }),
      ),
    ).toBe(true);
  });
});

function event(overrides: Partial<WorkspaceFileChangeEvent> = {}): WorkspaceFileChangeEvent {
  return {
    fileKind: "file",
    kind: "modified",
    path: "/workspace/package.json",
    previousPath: null,
    previousRelativePath: null,
    relativePath: "package.json",
    rootPath: "/workspace",
    ...overrides,
  };
}
