import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { resolvePhpClassName } from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpClassMemberCollectors,
  type PhpClassMemberCollectors,
} from "./usePhpClassMemberCollectors";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);

type HookOptions = Parameters<typeof usePhpClassMemberCollectors>[0];

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

function classPath(className: string): string {
  return `${ROOT}/${className.split("\\").join("/")}.php`;
}

function makeOptions(
  classes: Record<string, string>,
  overrides: Partial<HookOptions> = {},
): HookOptions {
  const currentWorkspaceRootRef = { current: ROOT };
  const sourcesByPath = new Map(
    Object.entries(classes).map(([className, source]) => [
      classPath(className),
      source,
    ]),
  );

  return {
    currentPhpFrameworkSourceContext: () => ({
      signature: "",
      workspaceSources: [],
    }),
    currentWorkspaceRootRef,
    frameworkRuntime: GENERIC_RUNTIME,
    readNavigationFileContent: vi.fn(async (path: string) => {
      const source = sourcesByPath.get(path);

      if (source === undefined) {
        throw new Error(`Missing class source for ${path}`);
      }

      return source;
    }),
    resolvePhpClassReference: (source, className) =>
      resolvePhpClassName(source, className),
    resolvePhpClassSourcePaths: vi.fn(async (className: string) => {
      const normalizedClassName = className.trim().replace(/^\\+/, "");

      return sourcesByPath.has(classPath(normalizedClassName))
        ? [classPath(normalizedClassName)]
        : [];
    }),
    resolvePhpDeclaredType: (source, typeName) =>
      typeName ? resolvePhpClassName(source, typeName) : null,
    resolvePhpFrameworkBoundConcrete: vi.fn(async () => null),
    workspaceDescriptor: phpDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpClassMemberCollectors | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpClassMemberCollectors(hookOptions);
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

describe("usePhpClassMemberCollectors", () => {
  it("keeps direct private and inherited protected members but drops ancestor private members", async () => {
    const options = makeOptions({
      "App\\BaseRepository": `<?php
namespace App;
class BaseRepository
{
    protected string $inheritedProtectedProperty = 'visible';
    private string $inheritedPrivateProperty = 'hidden';
    public function inheritedPublic(): void {}
    protected function inheritedProtected(): void {}
    private function inheritedPrivate(): void {}
}
`,
      "App\\PostRepository": `<?php
namespace App;
class PostRepository extends BaseRepository
{
    private string $directPrivateProperty = 'visible';
    private function directPrivate(): void {}
}
`,
    });
    const harness = renderHook(options);
    const members = await harness.api().collectPhpMethodsForClass(
      "App\\PostRepository",
      { includeNonPublicMembers: true },
    );
    const membersByName = new Map(members.map((member) => [member.name, member]));

    expect(Array.from(membersByName.keys())).toEqual([
      "directPrivate",
      "directPrivateProperty",
      "inheritedPublic",
      "inheritedProtected",
      "inheritedProtectedProperty",
    ]);
    expect(membersByName.get("directPrivate")?.declaringClassDepth).toBe(0);
    expect(
      membersByName.get("directPrivateProperty")?.declaringClassDepth,
    ).toBe(0);
    expect(
      membersByName.get("inheritedProtectedProperty")?.declaringClassDepth,
    ).toBe(1);
    expect(membersByName.get("inheritedPublic")?.declaringClassDepth).toBe(1);
    expect(membersByName.get("inheritedProtected")?.declaringClassDepth).toBe(1);
    expect(membersByName.has("inheritedPrivate")).toBe(false);
    expect(membersByName.has("inheritedPrivateProperty")).toBe(false);

    harness.unmount();
  });

  it("reuses cached members for the same source signature and resets on demand", async () => {
    const source = `<?php
class User
{
    public function activate(): void {}
}
`;
    const options = makeOptions({ User: source });
    const harness = renderHook(options);

    const first = await harness.api().readPhpClassMembersFromPath(
      classPath("User"),
      "User",
    );
    const second = await harness.api().readPhpClassMembersFromPath(
      classPath("User"),
      "User",
    );

    expect(options.readNavigationFileContent).toHaveBeenCalledTimes(2);
    expect(second.members).toBe(first.members);

    harness.api().resetPhpClassMemberCache();

    const third = await harness.api().readPhpClassMembersFromPath(
      classPath("User"),
      "User",
    );

    expect(third.members).not.toBe(first.members);
    expect(third.members.map((member) => member.name)).toEqual(["activate"]);

    harness.unmount();
  });

  it("drops collected methods when the workspace root changes after an awaited member read", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const deferred = createDeferred<string>();
    const options = makeOptions(
      {
        User: `<?php
class User
{
    public function activate(): void {}
}
`,
      },
      {
        currentWorkspaceRootRef,
        readNavigationFileContent: vi.fn(async () => deferred.promise),
      },
    );
    const harness = renderHook(options);
    const completionsPromise = harness.api().collectPhpMethodsForClass("User");

    await Promise.resolve();
    currentWorkspaceRootRef.current = "/other-workspace";
    deferred.resolve(`<?php
class User
{
    public function activate(): void {}
}
`);

    await expect(completionsPromise).resolves.toEqual([]);

    harness.unmount();
  });

  it("expands interface members with a unique framework-bound concrete", async () => {
    const resolvePhpFrameworkBoundConcrete = vi.fn(
      async (className: string) =>
        className === "App\\Contracts\\StorageInterface"
          ? "App\\Storage\\RedisStorage"
          : null,
    );
    const harness = renderHook(
      makeOptions(
        {
          "App\\Contracts\\StorageInterface": `<?php
namespace App\\Contracts;

interface StorageInterface
{
    public function touch(): void;
}
`,
          "App\\Storage\\RedisStorage": `<?php
namespace App\\Storage;

use App\\Contracts\\StorageInterface;

class RedisStorage implements StorageInterface
{
    public function touch(): void {}

    public function score(): int
    {
        return 0;
    }
}
`,
        },
        { resolvePhpFrameworkBoundConcrete },
      ),
    );

    const completions = await harness.api().collectPhpMethodsForClass(
      "App\\Contracts\\StorageInterface",
    );

    expect(completions.map((completion) => completion.name)).toEqual([
      "touch",
      "score",
    ]);
    expect(completions[0]).toEqual(
      expect.objectContaining({
        declaringClassName: "App\\Contracts\\StorageInterface",
        name: "touch",
      }),
    );
    expect(completions[1]).toEqual(
      expect.objectContaining({
        declaringClassName: "App\\Storage\\RedisStorage",
        name: "score",
      }),
    );
    expect(resolvePhpFrameworkBoundConcrete).toHaveBeenCalledWith(
      "App\\Contracts\\StorageInterface",
    );

    harness.unmount();
  });

  it("collects Laravel dynamic where methods from model attributes", async () => {
    const harness = renderHook(
      makeOptions(
        {
          "App\\Models\\User": `<?php
namespace App\\Models;

class User
{
    protected $fillable = ['email'];
}
`,
        },
        { frameworkRuntime: LARAVEL_RUNTIME },
      ),
    );

    const completions =
      await harness.api().collectPhpFrameworkSyntheticMethodsForClass(
        "App\\Models\\User",
        { isStatic: true },
      );

    expect(completions).toContainEqual(
      expect.objectContaining({
        isStatic: true,
        kind: "magic-where",
        name: "whereEmail",
      }),
    );

    harness.unmount();
  });

  it("uses runtime Laravel state for the Laravel gate", async () => {
    const readNavigationFileContent = vi.fn(async () => "");
    const resolvePhpClassSourcePaths = vi.fn(async () => []);
    const harness = renderHook(
      makeOptions(
        {
          "App\\Models\\User": `<?php
namespace App\\Models;

class User
{
    protected $fillable = ['email'];
}
`,
        },
        {
          frameworkRuntime: GENERIC_RUNTIME,
          readNavigationFileContent,
          resolvePhpClassSourcePaths,
        },
      ),
    );

    await expect(
      harness.api().collectPhpFrameworkSyntheticMethodsForClass(
        "App\\Models\\User",
        { isStatic: true },
      ),
    ).resolves.toEqual([]);
    await expect(
      harness.api().collectPhpFrameworkRelationCompletionsForClass(
        "App\\Models\\User",
      ),
    ).resolves.toEqual([]);
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("collects Laravel relation completions across model methods", async () => {
    const harness = renderHook(
      makeOptions(
        {
          "App\\Models\\User": `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class User
{
    public function posts(): HasMany
    {
        return $this->hasMany(Post::class);
    }
}
`,
        },
        { frameworkRuntime: LARAVEL_RUNTIME },
      ),
    );

    const completions =
      await harness.api().collectPhpFrameworkRelationCompletionsForClass(
        "App\\Models\\User",
      );

    expect(completions).toContainEqual(
      expect.objectContaining({
        kind: "relation",
        name: "posts",
      }),
    );

    harness.unmount();
  });

  it("resolves generic template types for inherited and mixin class references", async () => {
    const source = `<?php
namespace App\\Repositories;

use App\\Models\\User;
use App\\Support\\BaseRepository;

/**
 * @extends BaseRepository<User>
 * @mixin BaseRepository<User>
 */
class UserRepository extends BaseRepository
{
}
`;
    const harness = renderHook(
      makeOptions({
        "App\\Repositories\\UserRepository": source,
        "App\\Support\\BaseRepository": `<?php
namespace App\\Support;

/**
 * @template TModel
 */
class BaseRepository
{
}
`,
      }),
    );

    const inherited =
      await harness.api().resolvePhpGenericTemplateTypesForInheritedClass(
        source,
        "App\\Support\\BaseRepository",
      );
    const mixin = await harness.api().resolvePhpGenericTemplateTypesForMixinClass(
      source,
      "App\\Support\\BaseRepository",
    );

    expect(inherited.get("tmodel")).toBe("App\\Models\\User");
    expect(mixin.get("tmodel")).toBe("App\\Models\\User");

    harness.unmount();
  });
});
