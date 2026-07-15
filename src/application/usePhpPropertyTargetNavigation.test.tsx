// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "../domain/workspace";
import {
  usePhpPropertyTargetNavigation,
  type PhpPropertyTargetNavigation,
  type PhpPropertyTargetNavigationDependencies,
} from "./usePhpPropertyTargetNavigation";

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

function makeDeps(
  overrides: Partial<PhpPropertyTargetNavigationDependencies> = {},
): PhpPropertyTargetNavigationDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    openNavigationTarget: vi.fn(async () => true),
    readNavigationFileContent: vi.fn(
      async () => `<?php
namespace App\\Models;

class Invoice
{
    protected string $number;
}`,
    ),
    resolvePhpClassReference: vi.fn((_source, reference) =>
      reference === "HasBilling" ? "App\\Models\\Concerns\\HasBilling" : null,
    ),
    resolvePhpClassSourcePaths: vi.fn(async (className) =>
      className === "App\\Models\\Invoice"
        ? [`${ROOT}/app/Models/Invoice.php`]
        : [],
    ),
    workspaceDescriptor: PHP_DESCRIPTOR,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpPropertyTargetNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpPropertyTargetNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpPropertyTargetNavigationDependencies;
  }) {
    captured.api = usePhpPropertyTargetNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpPropertyTargetNavigation => {
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

describe("usePhpPropertyTargetNavigation", () => {
  it("opens direct property declarations", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .openDirectPhpPropertyTarget("App\\Models\\Invoice", "number");

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Models/Invoice.php`,
      expect.objectContaining({ lineNumber: 6 }),
      "$number",
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("walks trait property declarations", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openNavigationTarget,
      readNavigationFileContent: vi.fn(async (path) => {
        if (path.endsWith("Invoice.php")) {
          return `<?php
namespace App\\Models;

class Invoice
{
    use HasBilling;
}`;
        }

        return `<?php
namespace App\\Models\\Concerns;

trait HasBilling
{
    protected string $billingCode;
}`;
      }),
      resolvePhpClassSourcePaths: vi.fn(async (className) => {
        if (className === "App\\Models\\Invoice") {
          return [`${ROOT}/app/Models/Invoice.php`];
        }

        if (className === "App\\Models\\Concerns\\HasBilling") {
          return [`${ROOT}/app/Models/Concerns/HasBilling.php`];
        }

        return [];
      }),
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .openDirectPhpPropertyTarget("App\\Models\\Invoice", "billingCode");

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Models/Concerns/HasBilling.php`,
      expect.objectContaining({ lineNumber: 6 }),
      "$billingCode",
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("drops property targets when the active workspace changes", async () => {
    const content = deferred<string>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent: vi.fn(() => content.promise),
    });
    const harness = renderHook(deps);
    const navigationPromise = harness
      .api()
      .openDirectPhpPropertyTarget("App\\Models\\Invoice", "number");

    currentWorkspaceRootRef.current = OTHER_ROOT;
    content.resolve(`<?php
class Invoice
{
    protected string $number;
}`);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("fences an in-flight property open when its owner becomes stale", async () => {
    const targetOpen = deferred<boolean>();
    let requestActive = true;
    const openNavigationTarget = vi.fn(() => targetOpen.promise);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);
    const navigationPromise = harness
      .api()
      .openDirectPhpPropertyTarget("App\\Models\\Invoice", "number", {
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
