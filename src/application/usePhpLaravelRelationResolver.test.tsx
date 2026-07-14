// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { usePhpLaravelRelationResolver } from "./usePhpLaravelRelationResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const STALE_LARAVEL_RUNTIME: PhpFrameworkRuntimeContext = {
  ...GENERIC_RUNTIME,
  profile: "laravel",
  isLaravel: true,
  hasProvider: () => false,
};

type HookOptions = Parameters<typeof usePhpLaravelRelationResolver>[0];
type HookApi = ReturnType<typeof usePhpLaravelRelationResolver>;
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
  returnType: string | null = null,
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

function makeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: LARAVEL_RUNTIME,
    readPhpClassMembersFromPath: vi.fn(async () => ({
      content: "",
      members: [],
    })),
    resolvePhpClassReference: vi.fn((_source, className) => className),
    resolvePhpClassSourcePaths: vi.fn(async () => []),
    resolvePhpDeclaredType: vi.fn(() => null),
    resolvePhpGenericTemplateTypesForInheritedClass: vi.fn(async () => new Map()),
    resolvePhpGenericTemplateTypesForMixinClass: vi.fn(async () => new Map()),
    resolvePhpFrameworkProjectMorphMapModelType: vi.fn(async () => null),
    workspaceDescriptor: phpDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function makeClassOptions(
  classes: Record<string, ClassSource>,
  overrides: Partial<HookOptions> = {},
): HookOptions {
  const pathToClassName = new Map(
    Object.keys(classes).map((className) => [classPath(className), className]),
  );

  return makeOptions({
    readPhpClassMembersFromPath: vi.fn(async (path: string) => {
      const className = pathToClassName.get(path);
      const classSource = className ? classes[className] : null;

      if (!classSource) {
        throw new Error(`No class fixture for ${path}`);
      }

      return {
        content: classSource.source,
        members: classSource.members,
      };
    }),
    resolvePhpClassSourcePaths: vi.fn(async (className: string) =>
      classes[className] ? [classPath(className)] : [],
    ),
    ...overrides,
  });
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpLaravelRelationResolver(hookOptions);
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

describe("usePhpLaravelRelationResolver", () => {
  it("uses the project morph map for active Laravel morphTo relations", async () => {
    const resolvePhpFrameworkProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeClassOptions(
        {
          "App\\Models\\Comment": {
            members: [
              methodMember("App\\Models\\Comment", "commentable", "MorphTo"),
            ],
            source: `<?php
namespace App\\Models;

class Comment
{
    public function commentable()
    {
        return $this->morphTo();
    }
}
`,
          },
        },
        { resolvePhpFrameworkProjectMorphMapModelType },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpClassPropertyOrRelationType(
          "App\\Models\\Comment",
          "commentable",
        ),
    ).resolves.toBe("App\\Models\\Post");
    expect(resolvePhpFrameworkProjectMorphMapModelType).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("resolves chained relation path owner types for active Laravel", async () => {
    const harness = renderHook(
      makeClassOptions({
        "App\\Models\\User": {
          members: [methodMember("App\\Models\\User", "posts")],
          source: `<?php
namespace App\\Models;

class User
{
    public function posts()
    {
        return $this->hasMany(Post::class);
    }
}
`,
        },
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpLaravelRelationPathOwnerType("App\\Models\\User", ["posts"]),
    ).resolves.toBe("App\\Models\\Post");

    harness.unmount();
  });

  it("uses runtime Laravel state for the Laravel gate", async () => {
    const resolvePhpClassSourcePaths = vi.fn(async () => ["/unused.php"]);
    const options = makeOptions({
      frameworkRuntime: GENERIC_RUNTIME,
      resolvePhpClassSourcePaths,
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpLaravelRelationPathOwnerType("App\\Models\\Comment", [
          "author",
        ]),
    ).resolves.toBeNull();

    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not use the project morph map for stale Laravel runtimes without a provider", async () => {
    const resolvePhpFrameworkProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeClassOptions(
        {
          "App\\Models\\Comment": {
            members: [
              methodMember("App\\Models\\Comment", "commentable", "MorphTo"),
            ],
            source: `<?php
namespace App\\Models;

class Comment
{
    public function commentable()
    {
        return $this->morphTo();
    }
}
`,
          },
        },
        {
          frameworkRuntime: STALE_LARAVEL_RUNTIME,
          resolvePhpFrameworkProjectMorphMapModelType,
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpClassPropertyOrRelationType(
          "App\\Models\\Comment",
          "commentable",
        ),
    ).resolves.toBeNull();
    expect(resolvePhpFrameworkProjectMorphMapModelType).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not resolve chained relation path owner types for stale Laravel runtimes without a provider", async () => {
    const resolvePhpClassSourcePaths = vi.fn(async (className: string) =>
      className === "App\\Models\\User" ? [classPath(className)] : [],
    );
    const harness = renderHook(
      makeClassOptions(
        {
          "App\\Models\\User": {
            members: [methodMember("App\\Models\\User", "posts")],
            source: `<?php
namespace App\\Models;

class User
{
    public function posts()
    {
        return $this->hasMany(Post::class);
    }
}
`,
          },
        },
        {
          frameworkRuntime: STALE_LARAVEL_RUNTIME,
          resolvePhpClassSourcePaths,
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpLaravelRelationPathOwnerType("App\\Models\\User", ["posts"]),
    ).resolves.toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();

    harness.unmount();
  });
});
