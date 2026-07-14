// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpFrameworkModelNavigationTargets,
  type PhpFrameworkModelNavigationTargets,
  type PhpFrameworkModelNavigationTargetsDependencies,
} from "./usePhpFrameworkModelNavigationTargets";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const MODEL_PATH = `${ROOT}/app/Models/Comment.php`;
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const STALE_LEGACY_LARAVEL_RUNTIME = {
  ...LARAVEL_RUNTIME,
  providers: [],
  hasProvider: () => false,
  isLaravel: true,
};

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

function modelSource(): string {
  return `<?php

class Comment
{
    protected $fillable = [
        'content',
    ];
}
`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function makeDeps(
  overrides: Partial<PhpFrameworkModelNavigationTargetsDependencies> = {},
): PhpFrameworkModelNavigationTargetsDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: LARAVEL_RUNTIME,
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

function renderHook(deps: PhpFrameworkModelNavigationTargetsDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpFrameworkModelNavigationTargets | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpFrameworkModelNavigationTargetsDependencies;
  }) {
    captured.api = usePhpFrameworkModelNavigationTargets(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpFrameworkModelNavigationTargets => {
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

describe("usePhpFrameworkModelNavigationTargets", () => {
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
      harness.api().findValidationRuleModelTargets("users"),
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
      harness.api().findValidationRuleModelTargets("users"),
    ).resolves.toEqual([]);
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("skips validation rule model targets for a stale legacy Laravel runtime", async () => {
    const searchProjectSymbols = vi.fn(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Comment",
        kind: "class" as const,
        lineNumber: 3,
        name: "Comment",
        path: MODEL_PATH,
        relativePath: "app/Models/Comment.php",
      },
    ]);
    const resolvePhpClassSourcePaths = vi.fn(async () => [MODEL_PATH]);
    const readNavigationFileContent = vi.fn(async () => modelSource());
    const deps = makeDeps({
      frameworkRuntime: STALE_LEGACY_LARAVEL_RUNTIME,
      projectSymbolSearch: { searchProjectSymbols },
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
    });
    const harness = renderHook(deps);

    await expect(
      harness.api().findValidationRuleModelTargets("comments"),
    ).resolves.toEqual([]);
    expect(searchProjectSymbols).not.toHaveBeenCalled();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops validation model targets when workspace changes after reading a file", async () => {
    const sourceRead = deferred<string>();
    const readStarted = deferred<void>();
    const currentWorkspaceRootRef = { current: ROOT };
    const deps = makeDeps({
      currentWorkspaceRootRef,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(async () => [
          {
            column: 7,
            containerName: null,
            fullyQualifiedName: "App\\Models\\Comment",
            kind: "class" as const,
            lineNumber: 3,
            name: "Comment",
            path: MODEL_PATH,
            relativePath: "app/Models/Comment.php",
          },
        ]),
      },
      readNavigationFileContent: vi.fn(() => {
        readStarted.resolve();
        return sourceRead.promise;
      }),
    });
    const harness = renderHook(deps);
    const targetsPromise = harness
      .api()
      .findValidationRuleModelTargets("comments");

    await readStarted.promise;
    currentWorkspaceRootRef.current = OTHER_ROOT;
    sourceRead.resolve(modelSource());

    await expect(targetsPromise).resolves.toEqual([]);

    harness.unmount();
  });
});
