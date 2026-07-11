// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpLaravelModelNavigationTargets,
  type PhpLaravelModelNavigationTargets,
  type PhpLaravelModelNavigationTargetsDependencies,
} from "./usePhpLaravelModelNavigationTargets";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const MODEL_PATH = `${ROOT}/app/Models/Comment.php`;
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

function makeDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [{ dev: false, namespace: "App\\", paths: [`${ROOT}/app`] }],
    },
    rootPath: ROOT,
  };
}

function makeDeps(
  overrides: Partial<PhpLaravelModelNavigationTargetsDependencies> = {},
): PhpLaravelModelNavigationTargetsDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    isLaravelFrameworkActive: true,
    openNavigationTarget: vi.fn(async () => true),
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => []),
    },
    providers: [phpLaravelFrameworkProvider],
    readNavigationFileContent: vi.fn(async () => modelSource()),
    resolvePhpClassSourcePaths: vi.fn(async () => [MODEL_PATH]),
    workspaceDescriptor: makeDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpLaravelModelNavigationTargetsDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpLaravelModelNavigationTargets | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpLaravelModelNavigationTargetsDependencies;
  }) {
    captured.api = usePhpLaravelModelNavigationTargets(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpLaravelModelNavigationTargets => {
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

function modelSource(): string {
  return `<?php

class Comment
{
    protected $fillable = [
        'content',
    ];

    public function getFullNameAttribute(): string
    {
        return '';
    }
}
`;
}

describe("usePhpLaravelModelNavigationTargets", () => {
  it("finds explicit validation table models before convention matches", async () => {
    const accountPath = `${ROOT}/app/Models/Account.php`;
    const userPath = `${ROOT}/app/Models/User.php`;
    const searchProjectSymbols = vi.fn(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\User",
        kind: "class" as const,
        lineNumber: 3,
        name: "User",
        path: userPath,
        relativePath: "app/Models/User.php",
      },
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Account",
        kind: "class" as const,
        lineNumber: 3,
        name: "Account",
        path: accountPath,
        relativePath: "app/Models/Account.php",
      },
    ]);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === accountPath) {
        return `<?php
namespace App\\Models;
class Account extends Model { protected $table = 'users'; }
`;
      }

      return `<?php
namespace App\\Models;
class User extends Model {}
`;
    });
    const deps = makeDeps({
      projectSymbolSearch: { searchProjectSymbols },
      readNavigationFileContent,
      resolvePhpClassSourcePaths: vi.fn(async (className) =>
        className.endsWith("Account") ? [accountPath] : [userPath],
      ),
    });
    const harness = renderHook(deps);

    await expect(
      harness.api().findPhpLaravelValidationRuleModelTargets("users"),
    ).resolves.toEqual([
      {
        label: "App\\Models\\Account",
        path: accountPath,
        position: { column: 7, lineNumber: 3 },
      },
    ]);
    expect(searchProjectSymbols).toHaveBeenCalledWith(ROOT, "", 2000);

    harness.unmount();
  });

  it("excludes indexed model candidates from another workspace", async () => {
    const readNavigationFileContent = vi.fn(async () => modelSource());
    const deps = makeDeps({
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(async () => [
          {
            column: 1,
            containerName: null,
            fullyQualifiedName: "App\\Models\\User",
            kind: "class" as const,
            lineNumber: 1,
            name: "User",
            path: `${OTHER_ROOT}/app/Models/User.php`,
            relativePath: "app/Models/User.php",
          },
        ]),
      },
      readNavigationFileContent,
    });
    const harness = renderHook(deps);

    await expect(
      harness.api().findPhpLaravelValidationRuleModelTargets("users"),
    ).resolves.toEqual([]);
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("opens dynamic where targets from model attributes", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .openPhpLaravelDynamicWhereTarget("App\\Models\\Comment", "whereContent");

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledTimes(1);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      MODEL_PATH,
      expect.objectContaining<Partial<EditorPosition>>({ lineNumber: 6 }),
      "content",
    );

    harness.unmount();
  });

  it("falls back to accessor targets for model attributes", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .openPhpLaravelModelAttributeTarget("App\\Models\\Comment", "full_name");

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      MODEL_PATH,
      expect.objectContaining<Partial<EditorPosition>>({ lineNumber: 9 }),
      "full_name",
    );

    harness.unmount();
  });

  it("uses runtime Laravel state over the legacy boolean", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const readNavigationFileContent = vi.fn(async () => modelSource());
    const deps = makeDeps({
      frameworkRuntime: GENERIC_RUNTIME,
      isLaravelFrameworkActive: true,
      openNavigationTarget,
      readNavigationFileContent,
    });
    const harness = renderHook(deps);

    const handled = await harness
      .api()
      .openPhpLaravelModelAttributeTarget("App\\Models\\Comment", "full_name");

    expect(handled).toBe(false);
    expect(readNavigationFileContent).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops model target navigation when workspace changes after reading a file", async () => {
    const sourceRead = deferred<string>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent: vi.fn(() => sourceRead.promise),
    });
    const harness = renderHook(deps);
    const navigationPromise = harness
      .api()
      .openPhpLaravelDynamicWhereTarget("App\\Models\\Comment", "whereContent");

    currentWorkspaceRootRef.current = OTHER_ROOT;
    sourceRead.resolve(modelSource());

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });
});
