// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { WorkspaceDescriptor } from "../domain/workspace";
import {
  usePhpSuperMethodNavigation,
  type PhpSuperMethodNavigation,
  type PhpSuperMethodNavigationDependencies,
} from "./usePhpSuperMethodNavigation";

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
    psr4Roots: [],
  },
  rootPath: ROOT,
};

function makeDeps(
  overrides: Partial<PhpSuperMethodNavigationDependencies> = {},
): PhpSuperMethodNavigationDependencies {
  return {
    activeDocument: {
      content: `<?php
namespace App;

class Child extends ParentClass
{
    public function save(): void
    {
    }
}`,
      language: "php",
      name: "Child.php",
      path: `${ROOT}/app/Child.php`,
      savedContent: "",
    },
    activeEditorPositionRef: { current: { column: 21, lineNumber: 6 } },
    currentWorkspaceRootRef: { current: ROOT },
    openNavigationTarget: vi.fn(async () => true),
    readNavigationFileContent: vi.fn(async () => `<?php
namespace App;

class ParentClass
{
    public function save(): void
    {
    }
}`),
    resolvePhpClassReference: vi.fn((_source, reference) =>
      reference === "ParentClass" ? "App\\ParentClass" : null,
    ),
    resolvePhpClassSourcePaths: vi.fn(async (className) =>
      className === "App\\ParentClass"
        ? [`${ROOT}/app/ParentClass.php`]
        : [],
    ),
    setMessage: vi.fn(),
    workspaceDescriptor: PHP_DESCRIPTOR,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpSuperMethodNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpSuperMethodNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpSuperMethodNavigationDependencies;
  }) {
    captured.api = usePhpSuperMethodNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpSuperMethodNavigation => {
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

describe("usePhpSuperMethodNavigation", () => {
  it("opens the parent method declaration", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);

    const handled = await harness.api().goToSuperMethod();

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/ParentClass.php`,
      expect.objectContaining({ lineNumber: 6 }) as EditorPosition,
      "save()",
    );
    expect(deps.setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("walks ancestor hierarchy when the direct parent does not declare the method", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: `<?php

namespace App\\Services;

class Child extends MiddleService
{
    public function handle(): void
    {
    }
}`,
        language: "php",
        name: "Child.php",
        path: `${ROOT}/app/Services/Child.php`,
        savedContent: "",
      },
      activeEditorPositionRef: { current: { column: 21, lineNumber: 7 } },
      openNavigationTarget,
      readNavigationFileContent: vi.fn(async (path) => {
        if (path.endsWith("MiddleService.php")) {
          return `<?php

namespace App\\Services;

class MiddleService extends BaseService
{
    public function other(): void
    {
    }
}`;
        }

        return `<?php

namespace App\\Services;

class BaseService
{
    public function handle(): void
    {
    }
}`;
      }),
      resolvePhpClassReference: vi.fn((_source, reference) => {
        if (reference === "MiddleService") {
          return "App\\Services\\MiddleService";
        }

        if (reference === "BaseService") {
          return "App\\Services\\BaseService";
        }

        return null;
      }),
      resolvePhpClassSourcePaths: vi.fn(async (className) => {
        if (className === "App\\Services\\MiddleService") {
          return [`${ROOT}/app/Services/MiddleService.php`];
        }

        if (className === "App\\Services\\BaseService") {
          return [`${ROOT}/app/Services/BaseService.php`];
        }

        return [];
      }),
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToSuperMethod();

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/BaseService.php`,
      expect.objectContaining({ lineNumber: 7 }) as EditorPosition,
      "handle()",
    );

    harness.unmount();
  });

  it("drops super-method navigation when the active workspace changes", async () => {
    const parentContent = deferred<string>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent: vi.fn(() => parentContent.promise),
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToSuperMethod();

    currentWorkspaceRootRef.current = OTHER_ROOT;
    parentContent.resolve(`<?php
namespace App;

class ParentClass
{
    public function save(): void
    {
    }
}`);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(deps.setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("shows a scoped message when no super method exists", async () => {
    const setMessage = vi.fn();
    const deps = makeDeps({
      readNavigationFileContent: vi.fn(async () => `<?php
namespace App;

class ParentClass
{
}`),
      setMessage,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToSuperMethod();

    expect(handled).toBe(false);
    expect(setMessage).toHaveBeenCalledWith("No super method found for save().");

    harness.unmount();
  });
});
