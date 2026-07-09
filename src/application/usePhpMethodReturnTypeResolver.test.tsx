// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpMethodReturnTypeResolver,
  type UsePhpMethodReturnTypeResolverOptions,
} from "./usePhpMethodReturnTypeResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

type HookApi = ReturnType<typeof usePhpMethodReturnTypeResolver>;
type HookOptions = UsePhpMethodReturnTypeResolverOptions;

interface ClassSource {
  members?: PhpMethodCompletion[];
  source: string;
}

const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

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

function makeOptions(
  classes: Record<string, ClassSource>,
  overrides: Partial<HookOptions> = {},
): HookOptions {
  const currentWorkspaceRootRef = { current: ROOT };
  const pathToClassName = new Map(
    Object.keys(classes).map((className) => [classPath(className), className]),
  );

  return {
    activePhpFrameworkProviders: [],
    currentWorkspaceRootRef,
    frameworkRuntime: LARAVEL_RUNTIME,
    isLaravelFrameworkActive: false,
    readPhpClassMembersFromPath: vi.fn(async (path: string) => {
      const className = pathToClassName.get(path);

      if (!className) {
        throw new Error(`Missing class source for ${path}`);
      }

      const entry = classes[className];

      if (!entry) {
        throw new Error(`Missing class entry for ${className}`);
      }

      return {
        content: entry.source,
        members: entry.members ?? [],
      };
    }),
    resolvePhpClassReference: (_source, className) =>
      className.trim().replace(/^\\+/, "") || null,
    resolvePhpClassSourcePaths: vi.fn(async (className: string) => {
      const normalizedClassName = className.trim().replace(/^\\+/, "");

      return classes[normalizedClassName] ? [classPath(normalizedClassName)] : [];
    }),
    resolvePhpEloquentBuilderModelTypeRef: {
      current: vi.fn(async () => null),
    },
    resolvePhpFrameworkBoundConcrete: vi.fn(async () => null),
    resolvePhpFrameworkReturnTypeReference: (_source, typeName) =>
      typeName?.trim().replace(/^\\+/, "") || null,
    resolvePhpGenericTemplateTypesForInheritedClass: vi.fn(
      async (_source, _className, inheritedTemplateTypes) =>
        inheritedTemplateTypes ?? new Map<string, string>(),
    ),
    resolvePhpGenericTemplateTypesForMixinClass: vi.fn(
      async (_source, _className, inheritedTemplateTypes) =>
        inheritedTemplateTypes ?? new Map<string, string>(),
    ),
    resolvePhpLaravelProjectMorphMapModelType: vi.fn(async () => null),
    resolvePhpMethodDeclaredReturnType: (
      _source,
      typeName,
      _lateStaticClassName,
      _templateTypes,
    ) => typeName?.trim().replace(/^\\+/, "") || null,
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
    captured.api = usePhpMethodReturnTypeResolver(hookOptions);
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

describe("usePhpMethodReturnTypeResolver", () => {
  it("keeps generic runtime inert despite the legacy Laravel flag", async () => {
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions(
        {
          "App\\Repositories\\Posts": {
            members: [methodMember("App\\Repositories\\Posts", "load")],
            source: `<?php
namespace App\\Repositories;

class Posts
{
    public function load()
    {
        return \\App\\Models\\Post::findOrFail(1);
    }
}
`,
          },
        },
        {
          activePhpFrameworkProviders: [phpLaravelFrameworkProvider],
          frameworkRuntime: GENERIC_RUNTIME,
          isLaravelFrameworkActive: true,
          resolvePhpEloquentBuilderModelTypeRef: {
            current: resolvePhpEloquentBuilderModelType,
          },
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType("App\\Repositories\\Posts", "load"),
    ).resolves.toBeNull();
    expect(resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("redirects facades only under the Laravel runtime", async () => {
    const classes = {
      "Illuminate\\Cache\\CacheManager": {
        members: [
          methodMember(
            "Illuminate\\Cache\\CacheManager",
            "remember",
            "App\\DTO\\CachedValue",
          ),
        ],
        source: `<?php
namespace Illuminate\\Cache;

class CacheManager
{
    public function remember(): \\App\\DTO\\CachedValue {}
}
`,
      },
      "Illuminate\\Support\\Facades\\Cache": {
        members: [
          methodMember(
            "Illuminate\\Support\\Facades\\Cache",
            "remember",
            "App\\DTO\\FacadeValue",
          ),
        ],
        source: `<?php
namespace Illuminate\\Support\\Facades;

class Cache
{
    public static function remember(): \\App\\DTO\\FacadeValue {}
}
`,
      },
    };
    const genericHarness = renderHook(
      makeOptions(classes, { frameworkRuntime: GENERIC_RUNTIME }),
    );
    const laravelHarness = renderHook(
      makeOptions(classes, { frameworkRuntime: LARAVEL_RUNTIME }),
    );

    await expect(
      genericHarness
        .api()
        .resolvePhpMethodReturnType(
          "Illuminate\\Support\\Facades\\Cache",
          "remember",
        ),
    ).resolves.toBe("App\\DTO\\FacadeValue");
    await expect(
      laravelHarness
        .api()
        .resolvePhpMethodReturnType(
          "Illuminate\\Support\\Facades\\Cache",
          "remember",
        ),
    ).resolves.toBe("App\\DTO\\CachedValue");

    genericHarness.unmount();
    laravelHarness.unmount();
  });

  it("uses the project morph map for declared MorphTo methods returning morphTo", async () => {
    const resolvePhpLaravelProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions(
        {
          "App\\Models\\Comment": {
            members: [
              methodMember(
                "App\\Models\\Comment",
                "commentable",
                "MorphTo",
              ),
            ],
            source: `<?php
namespace App\\Models;

class Comment
{
    public function commentable(): \\Illuminate\\Database\\Eloquent\\Relations\\MorphTo
    {
        return $this->morphTo();
    }
}
`,
          },
        },
        {
          frameworkRuntime: LARAVEL_RUNTIME,
          resolvePhpLaravelProjectMorphMapModelType,
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType("App\\Models\\Comment", "commentable"),
    ).resolves.toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\MorphTo<App\\Models\\Post>",
    );
    expect(resolvePhpLaravelProjectMorphMapModelType).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("resolves untyped builder terminal calls through the builder model resolver", async () => {
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions(
        {
          "App\\Repositories\\Posts": {
            members: [methodMember("App\\Repositories\\Posts", "firstPost")],
            source: `<?php
namespace App\\Repositories;

class Posts
{
    public function firstPost()
    {
        return $query->first();
    }
}
`,
          },
        },
        {
          frameworkRuntime: LARAVEL_RUNTIME,
          resolvePhpEloquentBuilderModelTypeRef: {
            current: resolvePhpEloquentBuilderModelType,
          },
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType("App\\Repositories\\Posts", "firstPost"),
    ).resolves.toBe("App\\Models\\Post");
    expect(resolvePhpEloquentBuilderModelType).toHaveBeenCalledWith(
      expect.any(String),
      { column: 1, lineNumber: 1 },
      "$query",
    );

    harness.unmount();
  });

  it("resolves static findOrFail only under the Laravel runtime", async () => {
    const classes = {
      "App\\Repositories\\Posts": {
        members: [methodMember("App\\Repositories\\Posts", "load")],
        source: `<?php
namespace App\\Repositories;

class Posts
{
    public function load()
    {
        return \\App\\Models\\Post::findOrFail(1);
    }
}
`,
      },
      "App\\Models\\Post": {
        source: `<?php
namespace App\\Models;

class Post
{
}
`,
      },
    };
    const genericHarness = renderHook(
      makeOptions(classes, { frameworkRuntime: GENERIC_RUNTIME }),
    );
    const laravelHarness = renderHook(
      makeOptions(classes, { frameworkRuntime: LARAVEL_RUNTIME }),
    );

    await expect(
      genericHarness
        .api()
        .resolvePhpMethodReturnType("App\\Repositories\\Posts", "load"),
    ).resolves.toBeNull();
    await expect(
      laravelHarness
        .api()
        .resolvePhpMethodReturnType("App\\Repositories\\Posts", "load"),
    ).resolves.toBe("App\\Models\\Post");

    genericHarness.unmount();
    laravelHarness.unmount();
  });

  it("keeps provider return types ahead of Laravel method-call fallback", async () => {
    const provider: PhpFrameworkProvider = {
      id: "test-provider",
      semantics: {
        methodCallReturnTypeFromSource: ({ methodName }) =>
          methodName === "first" ? "App\\DTO\\ProviderResult" : null,
      },
    };
    const runtime = createPhpFrameworkRuntimeContext(
      createPhpFrameworkIntelligence({
        matchedProviderIds: ["laravel"],
        profile: "laravel",
        providers: [provider],
      }),
    );
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions(
        {
          "App\\Repositories\\Posts": {
            members: [methodMember("App\\Repositories\\Posts", "firstPost")],
            source: `<?php
namespace App\\Repositories;

class Posts
{
    public function firstPost()
    {
        return $query->first();
    }
}
`,
          },
        },
        {
          frameworkRuntime: runtime,
          resolvePhpEloquentBuilderModelTypeRef: {
            current: resolvePhpEloquentBuilderModelType,
          },
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType("App\\Repositories\\Posts", "firstPost"),
    ).resolves.toBe("App\\DTO\\ProviderResult");
    expect(resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();

    harness.unmount();
  });
});
