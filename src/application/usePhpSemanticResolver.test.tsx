// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
} from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import type { TextSearchResult } from "../domain/workspace";
import {
  usePhpSemanticResolver,
  type UsePhpSemanticResolverOptions,
} from "./usePhpSemanticResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const PROVIDER_PATH = `${ROOT}/app/Providers/AppServiceProvider.php`;

type Resolver = ReturnType<typeof usePhpSemanticResolver>;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function bindingSearchResult(path = PROVIDER_PATH): TextSearchResult {
  return {
    column: 20,
    lineNumber: 8,
    lineText:
      "$this->app->bind(CommentRepository::class, EloquentCommentRepository::class);",
    path,
    relativePath: path.slice(path.indexOf("/app/") + 1),
  };
}

function classSymbol(path: string, fullyQualifiedName: string) {
  const name = fullyQualifiedName.slice(
    fullyQualifiedName.lastIndexOf("\\") + 1,
  );
  return {
    column: 1,
    containerName: null,
    fullyQualifiedName,
    kind: "class" as const,
    lineNumber: 1,
    name,
    path,
    relativePath: path.slice(ROOT.length + 1),
  };
}

function bindingSource(): string {
  return `<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepository;
use App\\Repositories\\EloquentCommentRepository;

$this->app->bind(CommentRepository::class, EloquentCommentRepository::class);
`;
}

function makeOptions(
  overrides: Partial<UsePhpSemanticResolverOptions> = {},
): UsePhpSemanticResolverOptions {
  return {
    activePhpFrameworkProviders: [phpLaravelFrameworkProvider],
    currentPhpFrameworkSourceContext: () => ({ signature: "", workspaceSources: [] }),
    currentWorkspaceRootRef: { current: ROOT },
    fileSearch: { searchFiles: vi.fn(async () => []) },
    intelligenceMode: "basic",
    phpClassSourcePathCacheRef: { current: {} },
    phpFrameworkBindingCacheRef: { current: {} },
    projectSymbolSearch: { searchProjectSymbols: vi.fn(async () => []) },
    readNavigationFileContent: vi.fn(async () => bindingSource()),
    textSearch: {
      replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
      searchText: vi.fn(async () => []),
    },
    workspaceDescriptor: null,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function phpWorkspaceDescriptor(
  rootPath = ROOT,
): UsePhpSemanticResolverOptions["workspaceDescriptor"] {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app"] }],
    },
    rootPath,
  };
}

function renderResolver(initialOptions: UsePhpSemanticResolverOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: Resolver | null } = { api: null };

  function Harness({ options }: { options: UsePhpSemanticResolverOptions }) {
    captured.api = usePhpSemanticResolver(options);
    return null;
  }

  const rerender = (options: UsePhpSemanticResolverOptions) => {
    act(() => {
      root.render(<Harness options={options} />);
    });
  };
  rerender(initialOptions);

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("resolver hook not mounted");
      }

      return captured.api;
    },
    rerender,
    unmount: () => act(() => root.unmount()),
  };
}

describe("usePhpSemanticResolver container binding scans", () => {
  it("does not search for generic or Nette providers", async () => {
    const searchText = vi.fn(async () => []);
    const genericOptions = makeOptions({
      activePhpFrameworkProviders: [],
      textSearch: {
        replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
        searchText,
      },
    });
    const harness = renderResolver(genericOptions);

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Missing"),
    ).resolves.toBeNull();
    harness.rerender({
      ...genericOptions,
      activePhpFrameworkProviders: [phpNetteFrameworkProvider],
    });
    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Missing"),
    ).resolves.toBeNull();

    expect(searchText).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not resolve FQN-shaped Nette service IDs without type evidence", async () => {
    const searchText = vi.fn(async () => []);
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:1",
          workspaceSources: [
            [
              "services:",
              "    App\\Contracts\\Gateway: App\\Services\\NetteGateway",
            ].join("\n"),
          ],
        }),
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Gateway"),
    ).resolves.toBeNull();
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("resolves Nette autowired services by reading registered concrete class sources", async () => {
    const concretePath = `${ROOT}/app/Repository/DatabaseReportRepository.php`;
    const searchText = vi.fn(async () => []);
    const searchFiles = vi.fn(async () => [
      {
        name: "DatabaseReportRepository.php",
        path: concretePath,
        relativePath: "app/Repository/DatabaseReportRepository.php",
      },
    ]);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path !== concretePath) {
        throw new Error(`Unexpected read: ${path}`);
      }

      return `<?php
namespace App\\Repository;

use App\\Contracts\\ReportRepository;

final class DatabaseReportRepository implements ReportRepository
{
}
`;
    });
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:1",
          workspaceSources: [
            [
              "services:",
              "    reportRepository: App\\Repository\\DatabaseReportRepository",
            ].join("\n"),
          ],
        }),
        fileSearch: { searchFiles },
        readNavigationFileContent,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "App\\Contracts\\ReportRepository",
      ),
    ).resolves.toBe("App\\Repository\\DatabaseReportRepository");
    expect(readNavigationFileContent).toHaveBeenCalledWith(concretePath);
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("materializes a RouterFactory service method returning RouteList", async () => {
    const factoryPath = `${ROOT}/app/Routing/RouterFactory.php`;
    const factorySource = `<?php
namespace App\\Routing;

use Nette\\Application\\Routers\\RouteList;

// class CommentDecoy {}
#[Marker("class AttributeDecoy {}")]
final class RouterFactory
{
    public function createRouter(): RouteList
    {
        return new RouteList();
    }
}
`;
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path !== factoryPath) {
        throw new Error(`Unexpected read: ${path}`);
      }

      return factorySource;
    });
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:router-factory",
          workspaceSources: [
            `services:
    routerFactory: App\\Routing\\RouterFactory
    router: @routerFactory::createRouter
`,
          ],
        }),
        intelligenceMode: "fullSmart",
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn(async () => [
            classSymbol(factoryPath, "App\\Routing\\RouterFactory"),
          ]),
        },
        readNavigationFileContent,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "Nette\\Application\\Routers\\RouteList",
      ),
    ).resolves.toBe("Nette\\Application\\Routers\\RouteList");
    expect(readNavigationFileContent).toHaveBeenCalledTimes(2);
    expect(
      harness.api().isPhpFrameworkBindingSearchCandidatePath(factoryPath),
    ).toBe(true);

    harness.unmount();
  });

  it("requires class-method factories to be static but permits service methods", async () => {
    const factoryPath = `${ROOT}/app/Routing/RouterFactory.php`;
    const readNavigationFileContent = vi.fn(async () => `<?php
namespace App\\Routing;
class RouterFactory
{
    public function createRouter(): \\Nette\\Application\\Routers\\RouteList {}
}`);
    const resolve = async (factory: string) => {
      const harness = renderResolver(
        makeOptions({
          activePhpFrameworkProviders: [phpNetteFrameworkProvider],
          currentPhpFrameworkSourceContext: () => ({
            signature: `neon:${factory}`,
            workspaceSources: [
              `services:
    routerFactory: App\\Routing\\RouterFactory
    router: ${factory}
`,
            ],
          }),
          intelligenceMode: "fullSmart",
          projectSymbolSearch: {
            searchProjectSymbols: vi.fn(async () => [
              classSymbol(factoryPath, "App\\Routing\\RouterFactory"),
            ]),
          },
          readNavigationFileContent,
          workspaceDescriptor: phpWorkspaceDescriptor(),
        }),
      );
      const result = await harness.api().resolvePhpFrameworkBoundConcrete(
        "Nette\\Application\\Routers\\RouteList",
      );
      harness.unmount();
      return result;
    };

    await expect(resolve("App\\Routing\\RouterFactory::createRouter")).resolves.toBeNull();
    await expect(resolve("@routerFactory::createRouter")).resolves.toBe(
      "Nette\\Application\\Routers\\RouteList",
    );
  });

  it("materializes an inherited public factory method and tracks its parent", async () => {
    const childPath = `${ROOT}/app/Routing/ChildRouterFactory.php`;
    const parentPath = `${ROOT}/app/Routing/RouterFactory.php`;
    const sources = new Map([
      [
        childPath,
        `<?php
namespace App\\Routing;
final class ChildRouterFactory extends RouterFactory {}`,
      ],
      [
        parentPath,
        `<?php
namespace App\\Routing;
class RouterFactory
{
    public function createRouter(): \\Nette\\Application\\Routers\\RouteList {}
}`,
      ],
    ]);
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:inherited-factory",
          workspaceSources: [
            `services:
    childFactory:
        factory: App\\Routing\\ChildRouterFactory
        autowired: false
    router: @childFactory::createRouter
`,
          ],
        }),
        intelligenceMode: "fullSmart",
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn(async (_root, query) => {
            if (query === "ChildRouterFactory") {
              return [
                classSymbol(childPath, "App\\Routing\\ChildRouterFactory"),
              ];
            }

            if (query === "RouterFactory") {
              return [classSymbol(parentPath, "App\\Routing\\RouterFactory")];
            }

            return [];
          }),
        },
        readNavigationFileContent: vi.fn(async (path: string) => {
          const source = sources.get(path);

          if (!source) {
            throw new Error(`Unexpected read: ${path}`);
          }

          return source;
        }),
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "Nette\\Application\\Routers\\RouteList",
      ),
    ).resolves.toBe("Nette\\Application\\Routers\\RouteList");
    expect(
      harness.api().isPhpFrameworkBindingSearchCandidatePath(childPath),
    ).toBe(true);
    expect(
      harness.api().isPhpFrameworkBindingSearchCandidatePath(parentPath),
    ).toBe(true);
    harness.unmount();
  });

  it("late-binds inherited static returns while self stays on the parent", async () => {
    const childPath = `${ROOT}/app/Routing/ChildRouterFactory.php`;
    const parentPath = `${ROOT}/app/Routing/RouterFactory.php`;
    const sources = new Map([
      [
        childPath,
        `<?php
namespace App\\Routing;
final class ChildRouterFactory extends RouterFactory {}`,
      ],
      [
        parentPath,
        `<?php
namespace App\\Routing;
class RouterFactory
{
    public static function createLateStatic(): static {}
    public static function createSelf(): self {}
}`,
      ],
    ]);
    const resolve = async (methodName: string, requestedType: string) => {
      const readNavigationFileContent = vi.fn(async (path: string) => {
        const source = sources.get(path);

        if (!source) {
          throw new Error(`Unexpected read: ${path}`);
        }

        return source;
      });
      const harness = renderResolver(
        makeOptions({
          activePhpFrameworkProviders: [phpNetteFrameworkProvider],
          currentPhpFrameworkSourceContext: () => ({
            signature: `neon:late-static:${methodName}`,
            workspaceSources: [
              `services:\n    router: App\\Routing\\ChildRouterFactory::${methodName}`,
            ],
          }),
          intelligenceMode: "fullSmart",
          projectSymbolSearch: {
            searchProjectSymbols: vi.fn(async (_root, query) => {
              if (query === "ChildRouterFactory") {
                return [
                  classSymbol(childPath, "App\\Routing\\ChildRouterFactory"),
                ];
              }

              return [classSymbol(parentPath, "App\\Routing\\RouterFactory")];
            }),
          },
          readNavigationFileContent,
          workspaceDescriptor: phpWorkspaceDescriptor(),
        }),
      );
      const result = await harness
        .api()
        .resolvePhpFrameworkBoundConcrete(requestedType);
      harness.unmount();
      return { readCount: readNavigationFileContent.mock.calls.length, result };
    };

    await expect(
      resolve("createLateStatic", "App\\Routing\\ChildRouterFactory"),
    ).resolves.toEqual({
      readCount: 2,
      result: "App\\Routing\\ChildRouterFactory",
    });
    await expect(
      resolve("createSelf", "App\\Routing\\RouterFactory"),
    ).resolves.toEqual({
      readCount: 2,
      result: "App\\Routing\\RouterFactory",
    });
  });

  it("rejects protected inherited methods and bounded parent cycles", async () => {
    const childPath = `${ROOT}/app/Routing/ChildRouterFactory.php`;
    const parentPath = `${ROOT}/app/Routing/RouterFactory.php`;
    const resolve = async (parentMethod: string) => {
      const sources = new Map([
        [
          childPath,
          `<?php namespace App\\Routing;
class ChildRouterFactory extends RouterFactory {}`,
        ],
        [
          parentPath,
          `<?php namespace App\\Routing;
class RouterFactory extends ChildRouterFactory { ${parentMethod} }`,
        ],
      ]);
      const harness = renderResolver(
        makeOptions({
          activePhpFrameworkProviders: [phpNetteFrameworkProvider],
          currentPhpFrameworkSourceContext: () => ({
            signature: `neon:inherited-reject:${parentMethod}`,
            workspaceSources: [
              "services:\n    router: App\\Routing\\ChildRouterFactory::createRouter",
            ],
          }),
          intelligenceMode: "fullSmart",
          projectSymbolSearch: {
            searchProjectSymbols: vi.fn(async (_root, query) =>
              query === "ChildRouterFactory"
                ? [classSymbol(childPath, "App\\Routing\\ChildRouterFactory")]
                : [classSymbol(parentPath, "App\\Routing\\RouterFactory")],
            ),
          },
          readNavigationFileContent: vi.fn(async (path: string) => {
            const source = sources.get(path);
            if (!source) {
              throw new Error(`Unexpected read: ${path}`);
            }
            return source;
          }),
          workspaceDescriptor: phpWorkspaceDescriptor(),
        }),
      );
      const result = await harness.api().resolvePhpFrameworkBoundConcrete(
        "Nette\\Application\\Routers\\RouteList",
      );
      harness.unmount();
      return result;
    };

    await expect(
      resolve(
        "protected static function createRouter(): \\Nette\\Application\\Routers\\RouteList {}",
      ),
    ).resolves.toBeNull();
    await expect(
      resolve(
        "private static function createRouter(): \\Nette\\Application\\Routers\\RouteList {}",
      ),
    ).resolves.toBeNull();
    await expect(resolve("")).resolves.toBeNull();
  });

  it("coalesces factory materialization and drops an invalidated in-flight read", async () => {
    const factoryPath = `${ROOT}/app/Routing/RouterFactory.php`;
    const staleRead = createDeferred<string>();
    const currentRead = createDeferred<string>();
    const readNavigationFileContent = vi
      .fn()
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValueOnce(currentRead.promise);
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:coalesced-factory",
          workspaceSources: [
            "services:\n    router: App\\Routing\\RouterFactory::createRouter",
          ],
        }),
        intelligenceMode: "fullSmart",
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn(async () => [
            classSymbol(factoryPath, "App\\Routing\\RouterFactory"),
          ]),
        },
        readNavigationFileContent,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );
    const target = "Nette\\Application\\Routers\\RouteList";
    const stale = harness.api().resolvePhpFrameworkBoundConcrete(target);
    const staleCoalesced = harness.api().resolvePhpFrameworkBoundConcrete(target);

    await vi.waitFor(() => {
      expect(readNavigationFileContent).toHaveBeenCalledOnce();
    });
    harness.api().invalidatePhpFrameworkBindingCache();
    const current = harness.api().resolvePhpFrameworkBoundConcrete(target);
    staleRead.resolve(`<?php
namespace App\\Routing;
class RouterFactory { public static function createRouter(): \\Old\\RouteList {} }`);
    await expect(Promise.all([stale, staleCoalesced])).resolves.toEqual([
      null,
      null,
    ]);

    currentRead.resolve(`<?php
namespace App\\Routing;
class RouterFactory { public static function createRouter(): \\Nette\\Application\\Routers\\RouteList {} }`);
    await expect(current).resolves.toBe(target);
    expect(readNavigationFileContent).toHaveBeenCalledTimes(2);

    harness.unmount();
  });

  it("applies Nette override suppression and requested-contract preference at runtime", async () => {
    const sources = new Map([
      [
        `${ROOT}/app/Services/DisabledGateway.php`,
        `<?php
namespace App\\Services;

final class DisabledGateway implements \\App\\Contracts\\Gateway, \\App\\Contracts\\Suppressed
{
}
`,
      ],
      [
        `${ROOT}/app/Services/PreferredGateway.php`,
        `<?php
namespace App\\Services;

final class PreferredGateway implements \\App\\Contracts\\Gateway
{
}
`,
      ],
      [
        `${ROOT}/app/Services/OtherGateway.php`,
        `<?php
namespace App\\Services;

final class OtherGateway implements \\App\\Contracts\\Gateway
{
}
`,
      ],
    ]);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      const source = sources.get(path);

      if (!source) {
        throw new Error(`Unexpected read: ${path}`);
      }

      return source;
    });
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:runtime-precedence",
          workspaceSources: [
            `services:
    disabled:
        factory: App\\Services\\DisabledGateway
        autowired: false
    preferred:
        factory: App\\Services\\PreferredGateway
        autowired: App\\Contracts\\Gateway
    other: App\\Services\\OtherGateway
`,
            `services:
    disabled: App\\Services\\DisabledGateway
`,
          ],
        }),
        readNavigationFileContent,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Gateway"),
    ).resolves.toBe("App\\Services\\PreferredGateway");
    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Suppressed"),
    ).resolves.toBeNull();

    harness.unmount();
  });

  it("does not autowire explicit empty or malformed target policies", async () => {
    const concretePath = `${ROOT}/app/Services/EmptyGateway.php`;
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path !== concretePath) {
        throw new Error(`Unexpected read: ${path}`);
      }

      return `<?php
namespace App\\Services;

final class EmptyGateway implements \\App\\Contracts\\Gateway
{
}
`;
    });
    const resolve = async (autowired: string) => {
      const harness = renderResolver(
        makeOptions({
          activePhpFrameworkProviders: [phpNetteFrameworkProvider],
          currentPhpFrameworkSourceContext: () => ({
            signature: `neon:${autowired}`,
            workspaceSources: [
              `services:
    gateway:
        factory: App\\Services\\EmptyGateway
        autowired: ${autowired}
`,
            ],
          }),
          readNavigationFileContent,
          workspaceDescriptor: phpWorkspaceDescriptor(),
        }),
      );
      const result = await harness
        .api()
        .resolvePhpFrameworkBoundConcrete("App\\Contracts\\Gateway");
      harness.unmount();
      return result;
    };

    await expect(resolve("[]")).resolves.toBeNull();
    await expect(resolve("%malformed%")).resolves.toBeNull();
  });

  it("resolves Nette autowired services through an abstract parent implementing the requested interface", async () => {
    const concretePath = `${ROOT}/app/Repository/ConcreteChild.php`;
    const abstractPath = `${ROOT}/app/Repository/AbstractRepo.php`;
    const searchText = vi.fn(async () => []);
    const sources = new Map([
      [
        concretePath,
        `<?php
namespace App\\Repository;

final class ConcreteChild extends AbstractRepo
{
}
`,
      ],
      [
        abstractPath,
        `<?php
namespace App\\Repository;

abstract class AbstractRepo implements \\App\\Contracts\\ReportRepository
{
}
`,
      ],
    ]);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      const source = sources.get(path);

      if (!source) {
        throw new Error(`Unexpected read: ${path}`);
      }

      return source;
    });
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:1",
          workspaceSources: [
            [
              "services:",
              "    reportRepository: App\\Repository\\ConcreteChild",
            ].join("\n"),
          ],
        }),
        readNavigationFileContent,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "App\\Contracts\\ReportRepository",
      ),
    ).resolves.toBe("App\\Repository\\ConcreteChild");
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("resolves Nette autowired services through interface inheritance", async () => {
    const concretePath = `${ROOT}/app/Service/ConcreteGateway.php`;
    const childInterfacePath = `${ROOT}/app/Contracts/ChildGateway.php`;
    const searchText = vi.fn(async () => []);
    const sources = new Map([
      [
        concretePath,
        `<?php
namespace App\\Service;

use App\\Contracts\\ChildGateway;

final class ConcreteGateway implements ChildGateway
{
}
`,
      ],
      [
        childInterfacePath,
        `<?php
namespace App\\Contracts;

interface ChildGateway extends ParentGateway
{
}
`,
      ],
    ]);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      const source = sources.get(path);

      if (!source) {
        throw new Error(`Unexpected read: ${path}`);
      }

      return source;
    });
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:1",
          workspaceSources: [
            [
              "services:",
              "    gateway: App\\Service\\ConcreteGateway",
            ].join("\n"),
          ],
        }),
        readNavigationFileContent,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "App\\Contracts\\ParentGateway",
      ),
    ).resolves.toBe("App\\Service\\ConcreteGateway");
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("stops cyclic Nette autowire hierarchy lookups without guessing", async () => {
    const concretePath = `${ROOT}/app/Service/ConcreteGateway.php`;
    const firstInterfacePath = `${ROOT}/app/Contracts/FirstGateway.php`;
    const secondInterfacePath = `${ROOT}/app/Contracts/SecondGateway.php`;
    const searchText = vi.fn(async () => []);
    const sources = new Map([
      [
        concretePath,
        `<?php
namespace App\\Service;

use App\\Contracts\\FirstGateway;

final class ConcreteGateway implements FirstGateway
{
}
`,
      ],
      [
        firstInterfacePath,
        `<?php
namespace App\\Contracts;

interface FirstGateway extends SecondGateway
{
}
`,
      ],
      [
        secondInterfacePath,
        `<?php
namespace App\\Contracts;

interface SecondGateway extends FirstGateway
{
}
`,
      ],
    ]);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      const source = sources.get(path);

      if (!source) {
        throw new Error(`Unexpected read: ${path}`);
      }

      return source;
    });
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:1",
          workspaceSources: [
            ["services:", "    gateway: App\\Service\\ConcreteGateway"].join(
              "\n",
            ),
          ],
        }),
        readNavigationFileContent,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "App\\Contracts\\MissingGateway",
      ),
    ).resolves.toBeNull();
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not cache transient Nette autowire read failures", async () => {
    const concretePath = `${ROOT}/app/Repository/DatabaseReportRepository.php`;
    const searchText = vi.fn(async () => []);
    const searchProjectSymbols = vi.fn(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Repository\\DatabaseReportRepository",
        kind: "class" as const,
        lineNumber: 7,
        name: "DatabaseReportRepository",
        path: concretePath,
        relativePath: "app/Repository/DatabaseReportRepository.php",
      },
    ]);
    const readNavigationFileContent = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient read failure"))
      .mockResolvedValueOnce(`<?php
namespace App\\Repository;

use App\\Contracts\\ReportRepository;

final class DatabaseReportRepository implements ReportRepository
{
}
`);
    const harness = renderResolver(
      makeOptions({
        activePhpFrameworkProviders: [phpNetteFrameworkProvider],
        currentPhpFrameworkSourceContext: () => ({
          signature: "neon:1",
          workspaceSources: [
            [
              "services:",
              "    reportRepository: App\\Repository\\DatabaseReportRepository",
            ].join("\n"),
          ],
        }),
        intelligenceMode: "fullSmart",
        projectSymbolSearch: { searchProjectSymbols },
        readNavigationFileContent,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "App\\Contracts\\ReportRepository",
      ),
    ).resolves.toBeNull();
    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "App\\Contracts\\ReportRepository",
      ),
    ).resolves.toBe("App\\Repository\\DatabaseReportRepository");
    expect(readNavigationFileContent).toHaveBeenCalledWith(concretePath);
    expect(searchProjectSymbols).toHaveBeenCalled();
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("invalidates Nette autowire misses when PHP class resolution becomes available", async () => {
    const concretePath = `${ROOT}/app/Repository/DatabaseReportRepository.php`;
    const searchText = vi.fn(async () => []);
    const readNavigationFileContent = vi.fn(async () => `<?php
namespace App\\Repository;

use App\\Contracts\\ReportRepository;

final class DatabaseReportRepository implements ReportRepository
{
}
`);
    const baseOptions = makeOptions({
      activePhpFrameworkProviders: [phpNetteFrameworkProvider],
      currentPhpFrameworkSourceContext: () => ({
        signature: "neon:1",
        workspaceSources: [
          [
            "services:",
            "    reportRepository: App\\Repository\\DatabaseReportRepository",
          ].join("\n"),
        ],
      }),
      readNavigationFileContent,
      textSearch: {
        replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
        searchText,
      },
      workspaceDescriptor: null,
    });
    const harness = renderResolver(baseOptions);

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "App\\Contracts\\ReportRepository",
      ),
    ).resolves.toBeNull();

    harness.rerender({
      ...baseOptions,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(
        "App\\Contracts\\ReportRepository",
      ),
    ).resolves.toBe("App\\Repository\\DatabaseReportRepository");
    expect(readNavigationFileContent).toHaveBeenCalledWith(concretePath);
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("invalidates cached Nette misses when framework source signatures change", async () => {
    const searchText = vi.fn(async () => []);
    const gatewayPath = `${ROOT}/app/Services/NetteGateway.php`;
    const emptySources = {
      signature: "",
      workspaceSources: [],
    };
    const loadedSources = {
      signature: "neon:1",
      workspaceSources: [
        [
          "services:",
          "    gateway: App\\Services\\NetteGateway",
        ].join("\n"),
      ],
    };
    const baseOptions = makeOptions({
      activePhpFrameworkProviders: [phpNetteFrameworkProvider],
      currentPhpFrameworkSourceContext: () => emptySources,
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path !== gatewayPath) {
          throw new Error(`Unexpected read: ${path}`);
        }

        return `<?php
namespace App\\Services;

final class NetteGateway implements \\App\\Contracts\\Gateway
{
}
`;
      }),
      textSearch: {
        replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
        searchText,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    const harness = renderResolver(baseOptions);

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Gateway"),
    ).resolves.toBeNull();

    harness.rerender({
      ...baseOptions,
      currentPhpFrameworkSourceContext: () => loadedSources,
    });

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Gateway"),
    ).resolves.toBe("App\\Services\\NetteGateway");
    expect(searchText).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("isolates Nette candidate results and caches across workspace roots", async () => {
    const otherRoot = "/other-workspace";
    const currentWorkspaceRootRef = { current: ROOT as string | null };
    const cacheRef = { current: {} as Record<string, string | null> };
    const sourceByPath = new Map([
      [
        `${ROOT}/app/Services/RootGateway.php`,
        `<?php
namespace App\\Services;

final class RootGateway implements \\App\\Contracts\\Gateway
{
}
`,
      ],
      [
        `${otherRoot}/app/Services/OtherGateway.php`,
        `<?php
namespace App\\Services;

final class OtherGateway implements \\App\\Contracts\\Gateway
{
}
`,
      ],
    ]);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      const source = sourceByPath.get(path);

      if (!source) {
        throw new Error(`Unexpected read: ${path}`);
      }

      return source;
    });
    const rootOptions = makeOptions({
      activePhpFrameworkProviders: [phpNetteFrameworkProvider],
      currentPhpFrameworkSourceContext: () => ({
        signature: "neon:root",
        workspaceSources: ["services:\n    gateway: App\\Services\\RootGateway"],
      }),
      currentWorkspaceRootRef,
      phpFrameworkBindingCacheRef: cacheRef,
      readNavigationFileContent,
      workspaceDescriptor: phpWorkspaceDescriptor(ROOT),
    });
    const harness = renderResolver(rootOptions);

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Gateway"),
    ).resolves.toBe("App\\Services\\RootGateway");

    currentWorkspaceRootRef.current = otherRoot;
    harness.rerender({
      ...rootOptions,
      currentPhpFrameworkSourceContext: () => ({
        signature: "neon:other",
        workspaceSources: ["services:\n    gateway: App\\Services\\OtherGateway"],
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(otherRoot),
      workspaceRoot: otherRoot,
    });

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Gateway"),
    ).resolves.toBe("App\\Services\\OtherGateway");
    expect(cacheRef.current).toEqual({
      "app\\contracts\\gateway": "App\\Services\\OtherGateway",
    });

    harness.unmount();
  });

  it("does not let stale Nette parent traversal poison the new root cache", async () => {
    const otherRoot = "/other-workspace";
    const currentWorkspaceRootRef = { current: ROOT as string | null };
    const cacheRef = { current: {} as Record<string, string | null> };
    const oldChildPath = `${ROOT}/app/Routing/ChildRouterFactory.php`;
    const oldParentPath = `${ROOT}/app/Routing/RouterFactory.php`;
    const newChildPath = `${otherRoot}/app/Routing/ChildRouterFactory.php`;
    const newParentPath = `${otherRoot}/app/Routing/RouterFactory.php`;
    const oldParentRead = createDeferred<string>();
    const childSource = `<?php
namespace App\\Routing;
final class ChildRouterFactory extends RouterFactory {}`;
    const validParentSource = `<?php
namespace App\\Routing;
class RouterFactory
{
    public static function createRouter(): \\Nette\\Application\\Routers\\RouteList {}
}`;
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === oldParentPath) {
        return oldParentRead.promise;
      }

      if (path === oldChildPath || path === newChildPath) {
        return childSource;
      }

      if (path === newParentPath) {
        return validParentSource;
      }

      throw new Error(`Unexpected read: ${path}`);
    });
    const projectSymbolSearch = {
      searchProjectSymbols: vi.fn(async (root: string, query: string) => {
        const path = query === "ChildRouterFactory"
          ? `${root}/app/Routing/ChildRouterFactory.php`
          : `${root}/app/Routing/RouterFactory.php`;
        const className = query === "ChildRouterFactory"
          ? "App\\Routing\\ChildRouterFactory"
          : "App\\Routing\\RouterFactory";
        return [classSymbol(path, className)];
      }),
    };
    const oldOptions = makeOptions({
      activePhpFrameworkProviders: [phpNetteFrameworkProvider],
      currentPhpFrameworkSourceContext: () => ({
        signature: "neon:old-factory",
        workspaceSources: [
          "services:\n    router: App\\Routing\\ChildRouterFactory::createRouter",
        ],
      }),
      currentWorkspaceRootRef,
      intelligenceMode: "fullSmart",
      phpFrameworkBindingCacheRef: cacheRef,
      projectSymbolSearch,
      readNavigationFileContent,
      workspaceDescriptor: phpWorkspaceDescriptor(ROOT),
    });
    const harness = renderResolver(oldOptions);
    const target = "Nette\\Application\\Routers\\RouteList";
    const stale = harness.api().resolvePhpFrameworkBoundConcrete(target);

    await vi.waitFor(() => {
      expect(readNavigationFileContent).toHaveBeenCalledWith(oldParentPath);
    });
    currentWorkspaceRootRef.current = otherRoot;
    harness.rerender({
      ...oldOptions,
      currentPhpFrameworkSourceContext: () => ({
        signature: "neon:new-factory",
        workspaceSources: [
          "services:\n    router: App\\Routing\\ChildRouterFactory::createRouter",
        ],
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(otherRoot),
      workspaceRoot: otherRoot,
    });

    oldParentRead.resolve(validParentSource);
    await expect(stale).resolves.toBeNull();
    expect(cacheRef.current).not.toHaveProperty(target.toLowerCase());
    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(target),
    ).resolves.toBe(target);
    expect(cacheRef.current).toEqual({ [target.toLowerCase()]: target });
    harness.unmount();
  });

  it("coalesces and caches Laravel misses", async () => {
    const search = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(() => search.promise);
    const harness = renderResolver(
      makeOptions({
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
      }),
    );

    const first = harness
      .api()
      .resolvePhpFrameworkBoundConcrete("App\\Contracts\\Missing");
    const concurrent = harness
      .api()
      .resolvePhpFrameworkBoundConcrete("App\\Contracts\\Missing");
    search.resolve([]);

    await expect(Promise.all([first, concurrent])).resolves.toEqual([null, null]);
    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Contracts\\Missing"),
    ).resolves.toBeNull();
    expect(searchText).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("caches positive Laravel binding results", async () => {
    const searchText = vi.fn(async () => [bindingSearchResult()]);
    const readNavigationFileContent = vi.fn(async () => bindingSource());
    const harness = renderResolver(
      makeOptions({
        readNavigationFileContent,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpFrameworkBoundConcrete("App\\Contracts\\CommentRepository"),
    ).resolves.toBe("App\\Repositories\\EloquentCommentRepository");
    await expect(
      harness
        .api()
        .resolvePhpFrameworkBoundConcrete("App\\Contracts\\CommentRepository"),
    ).resolves.toBe("App\\Repositories\\EloquentCommentRepository");

    expect(searchText).toHaveBeenCalledTimes(1);
    expect(readNavigationFileContent).toHaveBeenCalledTimes(1);
    expect(
      harness.api().isPhpFrameworkBindingSearchCandidatePath(PROVIDER_PATH),
    ).toBe(true);
    harness.unmount();
  });

  it("does not track an ordinary class search hit without parsed bindings", async () => {
    const classReferencePath = `${ROOT}/src/Foo.php`;
    const searchText = vi.fn(async () => [
      bindingSearchResult(classReferencePath),
    ]);
    const harness = renderResolver(
      makeOptions({
        readNavigationFileContent: vi.fn(
          async () => "<?php\nfinal class Consumer { public const TYPE = Foo::class; }\n",
        ),
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
      }),
    );

    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete("App\\Foo"),
    ).resolves.toBeNull();

    expect(
      harness.api().isPhpFrameworkBindingSearchCandidatePath(classReferencePath),
    ).toBe(false);
    harness.unmount();
  });

  it("retries after a candidate provider read fails", async () => {
    const searchText = vi.fn(async () => [bindingSearchResult()]);
    const readNavigationFileContent = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient read failure"))
      .mockResolvedValueOnce(bindingSource());
    const harness = renderResolver(
      makeOptions({
        readNavigationFileContent,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpFrameworkBoundConcrete("App\\Contracts\\CommentRepository"),
    ).resolves.toBeNull();
    await expect(
      harness
        .api()
        .resolvePhpFrameworkBoundConcrete("App\\Contracts\\CommentRepository"),
    ).resolves.toBe("App\\Repositories\\EloquentCommentRepository");

    expect(searchText).toHaveBeenCalledTimes(2);
    expect(readNavigationFileContent).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("caches a positive result found after another candidate read fails", async () => {
    const failedPath = `${ROOT}/app/Providers/BrokenServiceProvider.php`;
    const searchText = vi.fn(async () => [
      bindingSearchResult(failedPath),
      bindingSearchResult(),
    ]);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === failedPath) {
        throw new Error("transient read failure");
      }

      return bindingSource();
    });
    const harness = renderResolver(
      makeOptions({
        readNavigationFileContent,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
      }),
    );

    await expect(
      harness
        .api()
        .resolvePhpFrameworkBoundConcrete("App\\Contracts\\CommentRepository"),
    ).resolves.toBe("App\\Repositories\\EloquentCommentRepository");
    await expect(
      harness
        .api()
        .resolvePhpFrameworkBoundConcrete("App\\Contracts\\CommentRepository"),
    ).resolves.toBe("App\\Repositories\\EloquentCommentRepository");

    expect(searchText).toHaveBeenCalledTimes(1);
    expect(readNavigationFileContent).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("ignores an old generation and preserves the replacement in-flight lookup", async () => {
    const oldSearch = createDeferred<TextSearchResult[]>();
    const newSearch = createDeferred<TextSearchResult[]>();
    const searchText = vi
      .fn()
      .mockReturnValueOnce(oldSearch.promise)
      .mockReturnValueOnce(newSearch.promise);
    const cacheRef = { current: {} as Record<string, string | null> };
    const harness = renderResolver(
      makeOptions({
        phpFrameworkBindingCacheRef: cacheRef,
        textSearch: {
          replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
          searchText,
        },
      }),
    );

    const stale = harness
      .api()
      .resolvePhpFrameworkBoundConcrete("App\\Contracts\\Missing");
    harness.api().invalidatePhpFrameworkBindingCache();
    const current = harness
      .api()
      .resolvePhpFrameworkBoundConcrete("App\\Contracts\\Missing");
    oldSearch.resolve([bindingSearchResult()]);
    await expect(stale).resolves.toBeNull();

    const coalesced = harness
      .api()
      .resolvePhpFrameworkBoundConcrete("App\\Contracts\\Missing");
    expect(searchText).toHaveBeenCalledTimes(2);
    newSearch.resolve([]);
    await expect(Promise.all([current, coalesced])).resolves.toEqual([null, null]);
    expect(cacheRef.current).toHaveProperty("app\\contracts\\missing", null);
    harness.unmount();
  });

  it("ignores a promise from an old workspace root", async () => {
    const search = createDeferred<TextSearchResult[]>();
    const searchText = vi.fn(() => search.promise);
    const currentWorkspaceRootRef = { current: ROOT as string | null };
    const cacheRef = { current: {} as Record<string, string | null> };
    const options = makeOptions({
      currentWorkspaceRootRef,
      phpFrameworkBindingCacheRef: cacheRef,
      textSearch: {
        replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
        searchText,
      },
    });
    const harness = renderResolver(options);
    const stale = harness
      .api()
      .resolvePhpFrameworkBoundConcrete("App\\Contracts\\CommentRepository");

    currentWorkspaceRootRef.current = "/other-workspace";
    harness.rerender({ ...options, workspaceRoot: "/other-workspace" });
    search.resolve([bindingSearchResult()]);

    await expect(stale).resolves.toBeNull();
    expect(cacheRef.current).toEqual({});
    harness.unmount();
  });
});
