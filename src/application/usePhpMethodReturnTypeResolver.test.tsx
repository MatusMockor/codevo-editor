import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";

import {
  phpMethodCompletionsFromSource,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
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
const NETTE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["nette"],
    profile: "nette",
    providers: [phpNetteFrameworkProvider],
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
    currentWorkspaceRootRef,
    frameworkRuntime: LARAVEL_RUNTIME,
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

      return classes[normalizedClassName]
        ? [classPath(normalizedClassName)]
        : [];
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
    resolvePhpFrameworkProjectMorphMapModelType: vi.fn(async () => null),
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
  it("uses runtime Laravel state for the Laravel gate", async () => {
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
          frameworkRuntime: GENERIC_RUNTIME,
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
    const resolvePhpFrameworkProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const harness = renderHook(
      makeOptions(
        {
          "App\\Models\\Comment": {
            members: [
              methodMember("App\\Models\\Comment", "commentable", "MorphTo"),
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
          resolvePhpFrameworkProjectMorphMapModelType,
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
    expect(resolvePhpFrameworkProjectMorphMapModelType).toHaveBeenCalledTimes(
      1,
    );

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

  it("keeps an ebox ConsentCategoryRepository insert declaration ahead of Nette fallback", async () => {
    const repository =
      "Efabrica\\Crm\\ConsentModule\\Model\\Repository\\ConsentCategoryRepository";
    const harness = renderHook(
      makeOptions(
        {
          [repository]: {
            members: [methodMember(repository, "insert", "ActiveRow")],
            source: `<?php
namespace Efabrica\\Crm\\ConsentModule\\Model\\Repository;
use Efabrica\\Crm\\ActiveRowTypes\\Repository\\ConsentCategoriesRepositoryTrait;
use Nette\\Database\\Table\\ActiveRow;
final class ConsentCategoryRepository extends Repository
{
    use ConsentCategoriesRepositoryTrait;
    public function insert(array $data): ActiveRow {}
}`,
          },
          "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ConsentCategoriesActiveRow":
            {
              source: "<?php abstract class ConsentCategoriesActiveRow {}",
            },
          "Efabrica\\Crm\\ActiveRowTypes\\Selection\\ConsentCategoriesSelection":
            {
              source: "<?php abstract class ConsentCategoriesSelection {}",
            },
        },
        { frameworkRuntime: NETTE_RUNTIME },
      ),
    );

    await expect(
      harness.api().resolvePhpMethodReturnType(repository, "insert"),
    ).resolves.toBe("ActiveRow");

    harness.unmount();
  });

  it("keeps an ebox ProfileRepository custom nullable insert declaration", async () => {
    const repository =
      "Efabrica\\Crm\\ProfileModule\\Repository\\ProfileRepository";
    const harness = renderHook(
      makeOptions(
        {
          [repository]: {
            members: [
              methodMember(repository, "insert", "?ExtensibleActiveRow"),
            ],
            source: `<?php
namespace Efabrica\\Crm\\ProfileModule\\Repository;
use Efabrica\\Crm\\ActiveRowTypes\\Repository\\ProfilesRepositoryTrait;
use Efabrica\\Crm\\BaseModule\\ActiveRow\\ExtensibleActiveRow;
class ProfileRepository extends RecencyRepository
{
    use ProfilesRepositoryTrait;
    public function insert(array $data): ?ExtensibleActiveRow {}
}`,
          },
          "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ProfilesActiveRow": {
            source: "<?php abstract class ProfilesActiveRow {}",
          },
          "Efabrica\\Crm\\ActiveRowTypes\\Selection\\ProfilesSelection": {
            source: "<?php abstract class ProfilesSelection {}",
          },
        },
        { frameworkRuntime: NETTE_RUNTIME },
      ),
    );

    await expect(
      harness.api().resolvePhpMethodReturnType(repository, "insert"),
    ).resolves.toBe("?ExtensibleActiveRow");

    harness.unmount();
  });

  it("refines inherited Nette ActiveRow relations from the final literal call", async () => {
    const usersRow = "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow";
    const usersSelection =
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection";
    const userStatusesRow =
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UserStatusesActiveRow";
    const ordersSelection =
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\OrdersSelection";
    const inheritedActiveRow = "Nette\\Database\\Table\\ActiveRow";
    const harness = renderHook(
      makeOptions(
        {
          [usersRow]: {
            source: `<?php
namespace Efabrica\\Crm\\ActiveRowTypes\\ActiveRow;
abstract class UsersActiveRow extends \\Nette\\Database\\Table\\ActiveRow {}`,
          },
          [usersSelection]: {
            source: "<?php abstract class UsersSelection {}",
          },
          [userStatusesRow]: {
            source: "<?php abstract class UserStatusesActiveRow {}",
          },
          [ordersSelection]: {
            source: "<?php abstract class OrdersSelection {}",
          },
          [inheritedActiveRow]: {
            members: [
              methodMember(inheritedActiveRow, "ref", "?ActiveRow"),
              methodMember(inheritedActiveRow, "related", "Selection"),
            ],
            source: `<?php
namespace Nette\\Database\\Table;
class ActiveRow
{
    public function ref(string $key): ?ActiveRow {}
    public function related(string $key): Selection {}
}`,
          },
        },
        {
          frameworkRuntime: NETTE_RUNTIME,
          resolvePhpClassReference: (_source, className) => {
            const normalizedClassName = className.replace(/^\\+/, "");

            if (normalizedClassName === "ActiveRow") {
              return "Nette\\Database\\Table\\ActiveRow";
            }

            if (normalizedClassName === "Selection") {
              return "Nette\\Database\\Table\\Selection";
            }

            return normalizedClassName || null;
          },
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType(
          usersRow,
          "ref",
          new Set(),
          usersRow,
          new Map(),
          "$row->ref('user_statuses')",
        ),
    ).resolves.toBe(userStatusesRow);
    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType(
          usersRow,
          "related",
          new Set(),
          usersRow,
          new Map(),
          "$row->ref('users')->related('orders')",
        ),
    ).resolves.toBe(ordersSelection);
    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType(
          usersRow,
          "related",
          new Set(),
          usersRow,
          new Map(),
          "$row->ref('users')->related($table)",
        ),
    ).resolves.toBe("Selection");

    harness.unmount();
  });

  it("refines generated conditional Nette relation declarations and keeps safe dynamic fallbacks", async () => {
    const usersRow = "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow";
    const usersSelection =
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection";
    const userStatusesRow =
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UserStatusesActiveRow";
    const ordersSelection =
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\OrdersSelection";
    const usersSource = `<?php
namespace Efabrica\\Crm\\ActiveRowTypes\\ActiveRow;
/**
 * @method ($key is 'user_statuses' ? UserStatusesActiveRow|null : \\Nette\\Database\\Table\\ActiveRow|null) REF(string $key)
 * @method ($key is 'orders' ? \\Efabrica\\Crm\\ActiveRowTypes\\Selection\\OrdersSelection : \\Nette\\Database\\Table\\Selection) Related(string $key)
 */
abstract class UsersActiveRow extends \\Nette\\Database\\Table\\ActiveRow {}`;
    const harness = renderHook(
      makeOptions(
        {
          [usersRow]: {
            members: phpMethodCompletionsFromSource(usersSource, usersRow, {
            }),
            source: usersSource,
          },
          [usersSelection]: {
            source: "<?php abstract class UsersSelection {}",
          },
          [userStatusesRow]: {
            source: "<?php abstract class UserStatusesActiveRow {}",
          },
          [ordersSelection]: {
            source: "<?php abstract class OrdersSelection {}",
          },
        },
        {
          frameworkRuntime: NETTE_RUNTIME,
          resolvePhpClassReference: (_source, className) => {
            const normalizedClassName = className.replace(/^\\+/, "");

            if (normalizedClassName === "UserStatusesActiveRow") {
              return userStatusesRow;
            }

            return normalizedClassName || null;
          },
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType(
          usersRow,
          "REF",
          new Set(),
          usersRow,
          new Map(),
          "$row?->\n    REF(\n        'user_statuses',\n    )",
        ),
    ).resolves.toBe(userStatusesRow);
    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType(
          usersRow,
          "Related",
          new Set(),
          usersRow,
          new Map(),
          "$row?->REF('users')?->\n    RELATED('orders')",
        ),
    ).resolves.toBe(ordersSelection);
    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType(
          usersRow,
          "ref",
          new Set(),
          usersRow,
          new Map(),
          "$row->ref($table)",
        ),
    ).resolves.toBe("Nette\\Database\\Table\\ActiveRow");
    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType(
          usersRow,
          "related",
          new Set(),
          usersRow,
          new Map(),
          "$row->related($table)",
        ),
    ).resolves.toBe("Nette\\Database\\Table\\Selection");

    harness.unmount();
  });

  it("preserves an explicit concrete Nette relation return declaration", async () => {
    const usersRow = "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow";
    const usersSelection =
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection";
    const customRow = "App\\Database\\CustomUserActiveRow";
    const usersSource = `<?php
namespace Efabrica\\Crm\\ActiveRowTypes\\ActiveRow;
/** @method \\App\\Database\\CustomUserActiveRow ref(string $key) */
abstract class UsersActiveRow extends \\Nette\\Database\\Table\\ActiveRow {}`;
    const harness = renderHook(
      makeOptions(
        {
          [usersRow]: {
            members: phpMethodCompletionsFromSource(usersSource, usersRow, {
            }),
            source: usersSource,
          },
          [usersSelection]: {
            source: "<?php abstract class UsersSelection {}",
          },
          [customRow]: {
            source: "<?php class CustomUserActiveRow {}",
          },
        },
        {
          frameworkRuntime: NETTE_RUNTIME,
          resolvePhpMethodDeclaredReturnType: (_source, typeName) =>
            typeName?.replace(/^\\+/, "") ?? null,
        },
      ),
    );

    await expect(
      harness
        .api()
        .resolvePhpMethodReturnType(
          usersRow,
          "ref",
          new Set(),
          usersRow,
          new Map(),
          "$row->ref('user_statuses')",
        ),
    ).resolves.toBe(customRow);

    harness.unmount();
  });

  it.each([true, false])(
    "preserves a custom conditional with a generic Nette fallback when the convention class is %s",
    async (hasConventionClass) => {
      const usersRow =
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow";
      const usersSelection =
        "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection";
      const conventionalRow =
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\BillingActiveRow";
      const customRow = "App\\Database\\CustomBillingRow";
      const conditionalReturnType =
        "($key is 'billing' ? \\App\\Database\\CustomBillingRow : \\Nette\\Database\\Table\\ActiveRow|null)";
      const usersSource = `<?php
namespace Efabrica\\Crm\\ActiveRowTypes\\ActiveRow;
/** @method ${conditionalReturnType} ref(string $key) */
abstract class UsersActiveRow extends \\Nette\\Database\\Table\\ActiveRow {}`;
      const classes: Record<string, ClassSource> = {
        [usersRow]: {
          members: phpMethodCompletionsFromSource(usersSource, usersRow, {
          }),
          source: usersSource,
        },
        [usersSelection]: {
          source: "<?php abstract class UsersSelection {}",
        },
        [customRow]: {
          source: "<?php class CustomBillingRow {}",
        },
      };

      if (hasConventionClass) {
        classes[conventionalRow] = {
          source: "<?php abstract class BillingActiveRow {}",
        };
      }

      const harness = renderHook(
        makeOptions(classes, {
          frameworkRuntime: NETTE_RUNTIME,
          resolvePhpMethodDeclaredReturnType: (_source, typeName) =>
            typeName === conditionalReturnType ? customRow : typeName,
        }),
      );

      await expect(
        harness
          .api()
          .resolvePhpMethodReturnType(
            usersRow,
            "ref",
            new Set(),
            usersRow,
            new Map(),
            "$row->ref('billing')",
          ),
      ).resolves.toBe(customRow);

      harness.unmount();
    },
  );

  it.each([
    {
      alias: "BillingActiveRow",
      conventionType:
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\BillingActiveRow",
      customType: "App\\Database\\CustomBillingActiveRow",
      fallbackType: "\\Nette\\Database\\Table\\ActiveRow|null",
      literal: "billing",
      methodName: "ref",
    },
    {
      alias: "OrdersSelection",
      conventionType:
        "Efabrica\\Crm\\ActiveRowTypes\\Selection\\OrdersSelection",
      customType: "App\\Database\\CustomOrdersSelection",
      fallbackType: "\\Nette\\Database\\Table\\Selection",
      literal: "orders",
      methodName: "related",
    },
  ])(
    "preserves an imported custom $methodName alias ending in a generated family suffix",
    async ({
      alias,
      conventionType,
      customType,
      fallbackType,
      literal,
      methodName,
    }) => {
      const usersRow =
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow";
      const usersSelection =
        "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection";
      const conditionalReturnType = `($key is '${literal}' ? ${alias} : ${fallbackType})`;
      const customTypeParts = customType.split("\\");
      const customShortName =
        customTypeParts[customTypeParts.length - 1] ?? alias;
      const usersSource = `<?php
namespace Efabrica\\Crm\\ActiveRowTypes\\ActiveRow;
use ${customType} as ${alias};
/** @method ${conditionalReturnType} ${methodName}(string $key) */
abstract class UsersActiveRow extends \\Nette\\Database\\Table\\ActiveRow {}`;
      const harness = renderHook(
        makeOptions(
          {
            [usersRow]: {
              members: phpMethodCompletionsFromSource(usersSource, usersRow, {
              }),
              source: usersSource,
            },
            [usersSelection]: {
              source: "<?php abstract class UsersSelection {}",
            },
            [conventionType]: {
              source: `<?php abstract class ${alias} {}`,
            },
            [customType]: {
              source: `<?php class ${customShortName} {}`,
            },
          },
          {
            frameworkRuntime: NETTE_RUNTIME,
            resolvePhpClassReference: (_source, className) => {
              const normalizedClassName = className.replace(/^\\+/, "");

              if (normalizedClassName === alias) {
                return customType;
              }

              return normalizedClassName || null;
            },
            resolvePhpMethodDeclaredReturnType: (_source, typeName) =>
              typeName === conditionalReturnType ? customType : typeName,
          },
        ),
      );

      await expect(
        harness
          .api()
          .resolvePhpMethodReturnType(
            usersRow,
            methodName,
            new Set(),
            usersRow,
            new Map(),
            `$row->${methodName}('${literal}')`,
          ),
      ).resolves.toBe(customType);

      harness.unmount();
    },
  );

  it.each([
    {
      conventionType:
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\BillingActiveRow",
      declaredResolvedType: "App\\Database\\CustomActiveRow",
      declaredType: "ActiveRow|null",
      expectedType: "App\\Database\\CustomActiveRow",
      importSource: "use App\\Database\\CustomActiveRow as ActiveRow;",
      literal: "billing",
      methodName: "ref",
      shortType: "ActiveRow",
    },
    {
      conventionType:
        "Efabrica\\Crm\\ActiveRowTypes\\Selection\\OrdersSelection",
      declaredResolvedType: "App\\Database\\CustomSelection",
      declaredType: "Selection",
      expectedType: "App\\Database\\CustomSelection",
      importSource: "use App\\Database\\CustomSelection as Selection;",
      literal: "orders",
      methodName: "related",
      shortType: "Selection",
    },
    {
      conventionType:
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\BillingActiveRow",
      declaredResolvedType: "Nette\\Database\\Table\\ActiveRow",
      declaredType: "ActiveRow|null",
      expectedType:
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\BillingActiveRow",
      importSource: "use Nette\\Database\\Table\\ActiveRow;",
      literal: "billing",
      methodName: "ref",
      shortType: "ActiveRow",
    },
    {
      conventionType:
        "Efabrica\\Crm\\ActiveRowTypes\\Selection\\OrdersSelection",
      declaredResolvedType: "Nette\\Database\\Table\\Selection",
      declaredType: "\\Nette\\Database\\Table\\Selection",
      expectedType: "Efabrica\\Crm\\ActiveRowTypes\\Selection\\OrdersSelection",
      importSource: "",
      literal: "orders",
      methodName: "related",
      shortType: "Selection",
    },
  ])(
    "resolves standalone $methodName declaration provenance for $declaredType",
    async ({
      conventionType,
      declaredResolvedType,
      declaredType,
      expectedType,
      importSource,
      literal,
      methodName,
      shortType,
    }) => {
      const usersRow =
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow";
      const usersSelection =
        "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection";
      const usersSource = `<?php
namespace Efabrica\\Crm\\ActiveRowTypes\\ActiveRow;
${importSource}
/** @method ${declaredType} ${methodName}(string $key) */
abstract class UsersActiveRow extends \\Nette\\Database\\Table\\ActiveRow {}`;
      const classes: Record<string, ClassSource> = {
        [usersRow]: {
          members: phpMethodCompletionsFromSource(usersSource, usersRow, {
          }),
          source: usersSource,
        },
        [usersSelection]: {
          source: "<?php abstract class UsersSelection {}",
        },
        [conventionType]: {
          source: "<?php abstract class ConventionType {}",
        },
      };

      if (declaredResolvedType.startsWith("App\\")) {
        classes[declaredResolvedType] = {
          source: "<?php class CustomType {}",
        };
      }

      const harness = renderHook(
        makeOptions(classes, {
          frameworkRuntime: NETTE_RUNTIME,
          resolvePhpClassReference: (_source, className) => {
            const normalizedClassName = className.replace(/^\\+/, "");

            if (normalizedClassName === shortType) {
              return declaredResolvedType;
            }

            return normalizedClassName || null;
          },
          resolvePhpMethodDeclaredReturnType: (_source, typeName) =>
            typeName === declaredType ? declaredResolvedType : typeName,
        }),
      );

      await expect(
        harness
          .api()
          .resolvePhpMethodReturnType(
            usersRow,
            methodName,
            new Set(),
            usersRow,
            new Map(),
            `$row->${methodName}('${literal}')`,
          ),
      ).resolves.toBe(expectedType);

      harness.unmount();
    },
  );
});
