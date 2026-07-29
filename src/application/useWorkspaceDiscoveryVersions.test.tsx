// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { useWorkspaceDiscoveryVersions } from "./useWorkspaceDiscoveryVersions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useWorkspaceDiscoveryVersions", () => {
  it("exposes a stable explicit invalidation for JS coverage and inline results", () => {
    const harness = renderHook();
    const invalidate = harness.current().invalidateJsTestCoverageAndResults;

    act(() => invalidate());

    expect(harness.current().jsTestCoverageVersion).toBe(1);
    expect(harness.current().invalidateJsTestCoverageAndResults).toBe(invalidate);

    act(() => harness.current().invalidateJsTestCoverageAndResults());

    expect(harness.current().jsTestCoverageVersion).toBe(2);
    expect(harness.current().jsTestContinuousRunVersion).toBe(0);
    expect(harness.current().jsTestDiscoveryVersion).toBe(0);
    harness.unmount();
  });

  it("tracks Express, JS-test discovery, and coverage revisions independently", () => {
    const harness = renderHook();

    harness.publish(event({ relativePath: "src/routes.ts" }));
    expect(harness.current()).toMatchObject({
      expressRouteDiscoveryVersion: 1,
      jsTestContinuousRunVersion: 1,
      jsTestCoverageVersion: 1,
      jsTestDiscoveryVersion: 0,
      netteDiscoveryVersion: 0,
      nodePackageScriptDiscoveryVersion: 0,
      symfonyDiscoveryVersion: 0,
      workspacePackageDiscoveryVersion: 0,
    });

    harness.publish(event({ relativePath: "src/routes.test.ts" }));
    expect(harness.current()).toMatchObject({
      expressRouteDiscoveryVersion: 2,
      jsTestContinuousRunVersion: 2,
      jsTestCoverageVersion: 2,
      jsTestDiscoveryVersion: 1,
      netteDiscoveryVersion: 0,
      nodePackageScriptDiscoveryVersion: 0,
      symfonyDiscoveryVersion: 0,
      workspacePackageDiscoveryVersion: 0,
    });

    harness.publish(event({ relativePath: "package.json" }));
    expect(harness.current()).toMatchObject({
      expressRouteDiscoveryVersion: 3,
      jsTestContinuousRunVersion: 3,
      jsTestCoverageVersion: 3,
      jsTestDiscoveryVersion: 1,
      netteDiscoveryVersion: 0,
      nodePackageScriptDiscoveryVersion: 1,
      symfonyDiscoveryVersion: 0,
      workspacePackageDiscoveryVersion: 1,
    });

    harness.publish(event({ fileKind: "directory", kind: "created", relativePath: "src/http" }));
    expect(harness.current()).toMatchObject({
      expressRouteDiscoveryVersion: 4,
      jsTestContinuousRunVersion: 4,
      jsTestCoverageVersion: 4,
      jsTestDiscoveryVersion: 2,
      netteDiscoveryVersion: 0,
      nodePackageScriptDiscoveryVersion: 2,
      symfonyDiscoveryVersion: 1,
      workspacePackageDiscoveryVersion: 2,
    });

    harness.publish(event({ relativePath: "config/routes.yaml" }));
    expect(harness.current()).toMatchObject({
      expressRouteDiscoveryVersion: 4,
      jsTestContinuousRunVersion: 5,
      jsTestCoverageVersion: 4,
      jsTestDiscoveryVersion: 2,
      netteDiscoveryVersion: 0,
      nodePackageScriptDiscoveryVersion: 2,
      symfonyDiscoveryVersion: 2,
    });

    harness.publish(
      event({
        kind: "renamed",
        previousRelativePath: "src/Controller/HomeController.php",
        relativePath: "archive/HomeController.txt",
      }),
    );
    expect(harness.current()).toMatchObject({
      expressRouteDiscoveryVersion: 4,
      jsTestContinuousRunVersion: 6,
      jsTestCoverageVersion: 4,
      jsTestDiscoveryVersion: 2,
      netteDiscoveryVersion: 0,
      nodePackageScriptDiscoveryVersion: 2,
      symfonyDiscoveryVersion: 3,
    });

    harness.unmount();
  });

  it("does not restart package discovery for repeated excluded directory churn", () => {
    const harness = renderHook();
    const excludedRoots = ["node_modules", "vendor", "dist", "build", "coverage", "target"];

    for (let index = 0; index < 128; index += 1) {
      harness.publish(
        event({
          fileKind: "directory",
          kind: "created",
          relativePath: `${excludedRoots[index % excludedRoots.length]}/generated-${index}`,
        }),
      );
      harness.publish(
        event({
          fileKind: "directory",
          kind: "deleted",
          relativePath: `${excludedRoots[index % excludedRoots.length]}/removed-${index}`,
        }),
      );
    }

    expect(harness.current().workspacePackageDiscoveryVersion).toBe(0);

    harness.publish(event({ kind: "created", relativePath: "packages/new/package.json" }));

    expect(harness.current().workspacePackageDiscoveryVersion).toBe(1);
    harness.unmount();
  });

  it("restarts package discovery for ignore-rule changes and watcher rescan recovery", () => {
    const harness = renderHook();

    harness.publish(event({ relativePath: "packages/.gitignore" }));
    harness.publish(event({ kind: "rescanRequired", relativePath: "" }));

    expect(harness.current().workspacePackageDiscoveryVersion).toBe(2);
    harness.unmount();
  });

  it("advances Continuous Run for non-ignored watcher inputs only", () => {
    const harness = renderHook();

    for (const change of [
      event({ relativePath: "src/component.tsx" }),
      event({ relativePath: "tests/component.spec.ts" }),
      event({ relativePath: "vitest.config.ts" }),
      event({ relativePath: "configs/tsconfig.app.json" }),
      event({ relativePath: "pnpm-lock.yaml" }),
      event({
        kind: "renamed",
        previousRelativePath: "src/removed.js",
        relativePath: "archive/removed.txt",
      }),
      event({ fileKind: "directory", kind: "created", relativePath: "packages/new-package" }),
      event({ kind: "rescanRequired", relativePath: "" }),
    ]) {
      harness.publish(change);
    }

    expect(harness.current().jsTestContinuousRunVersion).toBe(8);

    for (const change of [
      event({ relativePath: "README.md" }),
      event({ relativePath: "config/routes.yaml" }),
      event({ relativePath: "dist/generated.js" }),
      event({ fileKind: "directory", kind: "modified", relativePath: "src" }),
      event({
        kind: "renamed",
        previousRelativePath: "README.md",
        relativePath: "docs/README.md",
      }),
    ]) {
      harness.publish(change);
    }

    expect(harness.current().jsTestContinuousRunVersion).toBe(11);
    expect(harness.current().jsTestCoverageVersion).toBe(9);

    act(() => harness.current().invalidateJsTestCoverageAndResults());

    expect(harness.current().jsTestCoverageVersion).toBe(10);
    expect(harness.current().jsTestContinuousRunVersion).toBe(11);
    harness.unmount();
  });

  it("tracks NEON changes only for full Nette applications", () => {
    const nette = renderHook(["nette/application"]);
    const latte = renderHook(["latte/latte"]);

    nette.publish(event({ relativePath: "config/services.neon" }));
    latte.publish(event({ relativePath: "config/services.neon" }));

    expect(nette.current().netteDiscoveryVersion).toBe(1);
    expect(latte.current().netteDiscoveryVersion).toBe(0);
    nette.unmount();
    latte.unmount();
  });

  it("advances PHP coverage only for external coverage inputs", () => {
    const harness = renderHook();

    harness.publish(event({ relativePath: "src/HomePresenter.php" }));
    expect(harness.current().phpTestCoverageInvalidationStore.getSnapshot()).toBe(1);
    harness.publish(event({ relativePath: "phpunit.xml.dist" }));
    expect(harness.current().phpTestCoverageInvalidationStore.getSnapshot()).toBe(2);
    harness.publish(event({ relativePath: "README.md" }));
    expect(harness.current().phpTestCoverageInvalidationStore.getSnapshot()).toBe(2);
    harness.unmount();
  });

  it("advances VS Code process-task discovery only for authoritative watcher inputs", () => {
    const harness = renderHook();

    for (const change of [
      event({ kind: "created", relativePath: ".vscode/tasks.json" }),
      event({ kind: "modified", relativePath: "./.vscode/tasks.json" }),
      event({ kind: "deleted", relativePath: ".vscode\\tasks.json" }),
      event({
        kind: "renamed",
        previousRelativePath: "archive/tasks.json",
        relativePath: ".vscode/tasks.json",
      }),
      event({
        kind: "renamed",
        previousRelativePath: ".vscode/tasks.json",
        relativePath: "archive/tasks.json",
      }),
      event({ fileKind: "directory", kind: "created", relativePath: ".vscode/" }),
      event({
        fileKind: "directory",
        kind: "renamed",
        previousRelativePath: "editor-config",
        relativePath: ".vscode",
      }),
      event({ kind: "rescanRequired", relativePath: "" }),
    ]) {
      harness.publish(change);
    }

    expect(harness.current().vscodeProcessTasksVersion).toBe(8);

    for (const change of [
      event({ relativePath: "packages/app/.vscode/tasks.json" }),
      event({ relativePath: "dist/.vscode/tasks.json" }),
      event({ relativePath: ".vscode/tasks.generated.json" }),
      event({ relativePath: ".vscode/launch.json" }),
      event({ fileKind: "directory", kind: "modified", relativePath: ".vscode" }),
      event({ fileKind: "directory", kind: "created", relativePath: ".vscode/generated" }),
      event({
        kind: "renamed",
        previousRelativePath: "tasks.json",
        relativePath: "generated/tasks.json",
      }),
      event({
        fileKind: "directory",
        kind: "renamed",
        previousRelativePath: ".vscode-generated",
        relativePath: "generated/.vscode",
      }),
    ]) {
      harness.publish(change);
    }

    expect(harness.current().vscodeProcessTasksVersion).toBe(8);
    harness.unmount();
  });

  it("advances Node launch configuration discovery for both authoritative files", () => {
    const harness = renderHook();

    for (const relativePath of [".codevo/launch.json", ".vscode\\launch.json"]) {
      for (const kind of ["created", "modified", "deleted"] as const) {
        harness.publish(event({ kind, relativePath }));
      }
      harness.publish(
        event({
          kind: "renamed",
          previousRelativePath: "archive/launch.json",
          relativePath,
        }),
      );
      harness.publish(
        event({
          kind: "renamed",
          previousRelativePath: relativePath,
          relativePath: "archive/launch.json",
        }),
      );
    }

    expect(harness.current().nodeLaunchConfigurationVersion).toBe(10);
    expect(harness.current().vscodeProcessTasksVersion).toBe(0);
    harness.unmount();
  });

  it("advances Node launch configuration discovery for relevant directory topology changes", () => {
    const harness = renderHook();

    for (const relativePath of [".codevo/", "./.vscode"]) {
      for (const kind of ["created", "deleted"] as const) {
        harness.publish(event({ fileKind: "directory", kind, relativePath }));
      }
      harness.publish(
        event({
          fileKind: "directory",
          kind: "renamed",
          previousRelativePath: "editor-config",
          relativePath,
        }),
      );
      harness.publish(
        event({
          fileKind: "directory",
          kind: "renamed",
          previousRelativePath: relativePath,
          relativePath: "editor-config",
        }),
      );
    }
    harness.publish(event({ kind: "rescanRequired", relativePath: "" }));

    expect(harness.current().nodeLaunchConfigurationVersion).toBe(9);
    harness.unmount();
  });

  it("ignores unrelated Node launch configuration watcher inputs", () => {
    const harness = renderHook();

    for (const change of [
      event({ relativePath: "launch.json" }),
      event({ relativePath: ".codevo/launch.generated.json" }),
      event({ relativePath: ".vscode/tasks.json" }),
      event({ relativePath: "packages/app/.codevo/launch.json" }),
      event({ relativePath: "packages/app/.vscode/launch.json" }),
      event({ fileKind: "directory", kind: "modified", relativePath: ".codevo" }),
      event({ fileKind: "directory", kind: "modified", relativePath: ".vscode" }),
      event({ fileKind: "directory", kind: "created", relativePath: ".codevo/generated" }),
      event({
        fileKind: "directory",
        kind: "renamed",
        previousRelativePath: ".codevo-generated",
        relativePath: "generated/.codevo",
      }),
      event({
        kind: "renamed",
        previousRelativePath: "launch.json",
        relativePath: "generated/launch.json",
      }),
    ]) {
      harness.publish(change);
    }

    expect(harness.current().nodeLaunchConfigurationVersion).toBe(0);
    harness.unmount();
  });
});

function renderHook(packageNames: string[] = []) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let current: ReturnType<typeof useWorkspaceDiscoveryVersions> | null = null;

  function Harness() {
    current = useWorkspaceDiscoveryVersions({
      phpProject: {
        classmapRoots: [],
        hasComposer: true,
        packageName: null,
        packages: packageNames.map((name) => ({
          classmapRoots: [],
          dev: false,
          installPath: null,
          name,
          packageType: null,
          psr4Roots: [],
          version: null,
        })),
        phpPlatformVersion: null,
        phpVersionConstraint: null,
        psr4Roots: [],
      },
      symfonyEnabled: true,
    });
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    current: () => {
      if (!current) throw new Error("hook did not render");
      return current;
    },
    publish: (change: WorkspaceFileChangeEvent) =>
      act(() => current?.handleWorkspaceDiscoveryFileChange(change)),
    unmount: () => act(() => root.unmount()),
  };
}

function event(overrides: Partial<WorkspaceFileChangeEvent> = {}): WorkspaceFileChangeEvent {
  return {
    kind: "modified",
    path: "/workspace/src/routes.ts",
    relativePath: "src/routes.ts",
    rootPath: "/workspace",
    ...overrides,
  };
}
