import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelCollectionModelTypeCandidate,
  phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
  phpLaravelEloquentBuilderModelTypeCandidate,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
} from "../domain/phpFrameworkLaravel";

import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpLaravelMethodGenericModelType,
  type UsePhpLaravelMethodGenericModelTypeOptions,
} from "./usePhpLaravelMethodGenericModelType";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

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
  hasProvider: (providerId: string) => providerId === "laravel",
  supports: () => false,
};
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

type HookOptions = UsePhpLaravelMethodGenericModelTypeOptions;
type HookApi = ReturnType<typeof usePhpLaravelMethodGenericModelType>;

interface ClassSource {
  members: PhpMethodCompletion[];
  source: string;
}

function phpDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [],
    },
    rootPath: ROOT,
  };
}

function methodMember(
  declaringClassName: string,
  name: string,
  returnType: string,
): PhpMethodCompletion {
  return {
    declaringClassName,
    name,
    parameters: "",
    returnType,
    visibility: "public",
  };
}

function classPath(className: string): string {
  return `${ROOT}/${className.split("\\").join("/")}.php`;
}

function makeOptions(
  classes: Record<string, ClassSource>,
  overrides: Partial<HookOptions> = {},
): HookOptions {
  const currentWorkspaceRootRef = { current: ROOT };
  const pathToClassName = new Map(
    Object.keys(classes).map((className) => [classPath(className), className]),
  );

  return {
    currentWorkspaceRootRef,
    frameworkRuntime: LARAVEL_RUNTIME,
    helpers: {
      builderCollectionModelTypeFromExpression:
        phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
      builderModelTypeCandidate: phpLaravelEloquentBuilderModelTypeCandidate,
      builderModelTypeFromExpression:
        phpLaravelEloquentBuilderModelTypeFromExpression,
      collectionModelTypeCandidate: phpLaravelCollectionModelTypeCandidate,
      repositoryConventionModelTypeFromCarrierReturnType:
        phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
    },
    readPhpClassMembersFromPath: vi.fn(async (path: string) => {
      const className = pathToClassName.get(path);

      if (!className) {
        throw new Error(`Missing class source for ${path}`);
      }

      return {
        content: classes[className].source,
        members: classes[className].members,
      };
    }),
    resolvePhpClassReference: (source, className) =>
      resolvePhpClassName(source, className),
    resolvePhpClassSourcePaths: vi.fn(async (className: string) => {
      const normalizedClassName = className.trim().replace(/^\\+/, "");

      return classes[normalizedClassName] ? [classPath(normalizedClassName)] : [];
    }),
    workspaceDescriptor: phpDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpLaravelMethodGenericModelType(hookOptions);
    return null;
  }

  act(() => {
    root.render(<Harness hookOptions={options} />);
  });

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpLaravelMethodGenericModelType", () => {
  it("returns null for generic runtimes without reading class members", async () => {
    const options = makeOptions(
      {
        "App\\Repositories\\AlbumRepository": {
          members: [
            methodMember(
              "App\\Repositories\\AlbumRepository",
              "query",
              "Builder<App\\Models\\Album>",
            ),
          ],
          source: `<?php
namespace App\\Repositories;

use Illuminate\\Database\\Eloquent\\Builder;

class AlbumRepository
{
}
`,
        },
      },
      { frameworkRuntime: GENERIC_RUNTIME },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpLaravelMethodGenericModelType(
          "builder",
          "App\\Repositories\\AlbumRepository",
          "query",
        ),
    ).resolves.toBeNull();

    expect(options.resolvePhpClassSourcePaths).not.toHaveBeenCalled();
    expect(options.readPhpClassMembersFromPath).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("returns null for stale provider-id-only Laravel profiles without Eloquent semantics", async () => {
    const options = makeOptions(
      {
        "App\\Repositories\\AlbumRepository": {
          members: [
            methodMember(
              "App\\Repositories\\AlbumRepository",
              "query",
              "Builder<App\\Models\\Album>",
            ),
          ],
          source: `<?php
namespace App\\Repositories;

use Illuminate\\Database\\Eloquent\\Builder;

class AlbumRepository
{
}
`,
        },
      },
      { frameworkRuntime: STALE_LEGACY_LARAVEL_RUNTIME },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpLaravelMethodGenericModelType(
          "builder",
          "App\\Repositories\\AlbumRepository",
          "query",
        ),
    ).resolves.toBeNull();

    expect(options.resolvePhpClassSourcePaths).not.toHaveBeenCalled();
    expect(options.readPhpClassMembersFromPath).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("resolves builder and collection generic models from method return types for Laravel runtimes", async () => {
    const options = makeOptions({
      "App\\Repositories\\AlbumRepository": {
        members: [
          methodMember(
            "App\\Repositories\\AlbumRepository",
            "query",
            "Builder<Album>",
          ),
          methodMember(
            "App\\Repositories\\AlbumRepository",
            "all",
            "Collection<int, Album>",
          ),
        ],
        source: `<?php
namespace App\\Repositories;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Collection;

class AlbumRepository
{
}
`,
      },
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpLaravelMethodGenericModelType(
          "builder",
          "App\\Repositories\\AlbumRepository",
          "query",
        ),
    ).resolves.toBe("App\\Models\\Album");
    await expect(
      harness
        .api()
        .resolvePhpLaravelMethodGenericModelType(
          "collection",
          "App\\Repositories\\AlbumRepository",
          "all",
        ),
    ).resolves.toBe("App\\Models\\Album");

    expect(options.readPhpClassMembersFromPath).toHaveBeenCalledWith(
      classPath("App\\Repositories\\AlbumRepository"),
      "App\\Repositories\\AlbumRepository",
    );

    harness.unmount();
  });
});
