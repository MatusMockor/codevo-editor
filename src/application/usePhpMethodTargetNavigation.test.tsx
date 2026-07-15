// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import type { WorkspaceDescriptor } from "../domain/workspace";
import {
  usePhpMethodTargetNavigation,
  type PhpMethodTargetNavigation,
  type PhpMethodTargetNavigationDependencies,
} from "./usePhpMethodTargetNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";

const PHP_DESCRIPTOR: WorkspaceDescriptor = {
  javaScriptTypeScript: null,
  php: {
    classmapRoots: [],
    hasComposer: true,
    packageName: "app/test",
    packages: [],
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app"] }],
  },
  rootPath: ROOT,
};

function methodSymbol(
  overrides: Partial<ProjectSymbolSearchResult> = {},
): ProjectSymbolSearchResult {
  return {
    column: 7,
    containerName: "App\\Services\\ReportService",
    fullyQualifiedName: "App\\Services\\ReportService::render",
    kind: "method",
    lineNumber: 12,
    name: "render",
    path: `${ROOT}/app/Services/ReportService.php`,
    relativePath: "app/Services/ReportService.php",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PhpMethodTargetNavigationDependencies> = {},
): PhpMethodTargetNavigationDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    intelligenceMode: "fullSmart",
    openNavigationTarget: vi.fn(async () => true),
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => [methodSymbol()]),
    },
    readNavigationFileContent: vi.fn(
      async () => `<?php
namespace App\\Services;

class ReportService
{
    public function render(): void
    {
    }
}`,
    ),
    resolvePhpClassReference: vi.fn((_source, reference) =>
      reference === "ReportTrait" ? "App\\Services\\ReportTrait" : null,
    ),
    resolvePhpClassSourcePaths: vi.fn(async (className) =>
      className === "App\\Services\\ReportService"
        ? [`${ROOT}/app/Services/ReportService.php`]
        : [],
    ),
    resolvePhpFrameworkBoundConcrete: vi.fn(async () => null),
    workspaceDescriptor: PHP_DESCRIPTOR,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpMethodTargetNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpMethodTargetNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpMethodTargetNavigationDependencies;
  }) {
    captured.api = usePhpMethodTargetNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpMethodTargetNavigation => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("usePhpMethodTargetNavigation", () => {
  it("opens indexed method symbols when indexing is active", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .openDirectPhpMethodTarget("App\\Services\\ReportService", "render");

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/ReportService.php`,
      { column: 7, lineNumber: 12 },
      "render()",
      { shouldCommit: expect.any(Function) },
    );
    expect(deps.readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("falls back to reading class hierarchy files when the index misses", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openNavigationTarget,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(async () => []),
      },
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .openDirectPhpMethodTarget("App\\Services\\ReportService", "render");

    expect(handled).toBe(true);
    expect(deps.resolvePhpClassSourcePaths).toHaveBeenCalledWith(
      "App\\Services\\ReportService",
    );
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/ReportService.php`,
      expect.objectContaining({ lineNumber: 6 }),
      "render()",
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("opens method definition hints through PSR-4 candidates", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      intelligenceMode: "basic",
      openNavigationTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().openPhpMethodHintTarget({
      className: "App\\Services\\ReportService",
      methodName: "render",
    });

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/ReportService.php`,
      expect.objectContaining({ lineNumber: 6 }),
      "render()",
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("drops method targets when the active workspace changes", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      currentWorkspaceRootRef,
      openNavigationTarget,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
    });
    const harness = renderHook(deps);
    const navigationPromise = harness
      .api()
      .openDirectPhpMethodTarget("App\\Services\\ReportService", "render");

    currentWorkspaceRootRef.current = OTHER_ROOT;
    symbols.resolve([methodSymbol()]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops method targets when the navigation request becomes stale after an awaited resolver", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    let requestActive = true;
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openNavigationTarget,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
    });
    const harness = renderHook(deps);
    const navigationPromise = harness
      .api()
      .openDirectPhpMethodTarget("App\\Services\\ReportService", "render", {
        canNavigate: () => requestActive,
      });

    requestActive = false;
    symbols.resolve([methodSymbol()]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(deps.readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("fences an in-flight method open when its owner becomes stale", async () => {
    const targetOpen = deferred<boolean>();
    let requestActive = true;
    const openNavigationTarget = vi.fn(() => targetOpen.promise);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);
    const navigationPromise = harness
      .api()
      .openDirectPhpMethodTarget("App\\Services\\ReportService", "render", {
        canNavigate: () => requestActive,
      });

    await vi.waitFor(() => expect(openNavigationTarget).toHaveBeenCalledOnce());
    const options = (openNavigationTarget.mock.calls[0] as unknown[])[3] as {
      shouldCommit?: () => boolean;
    };
    expect(options?.shouldCommit?.()).toBe(true);

    requestActive = false;
    expect(options?.shouldCommit?.()).toBe(false);
    targetOpen.resolve(true);

    await expect(navigationPromise).resolves.toBe(false);
    harness.unmount();
  });
});
