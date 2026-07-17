import { describe, expect, it, vi } from "vitest";
import {
  latteFunctionDiscoveryContext,
  loadLatteFunctionRegistrations,
  type LatteFunctionCache,
  type LatteFunctionDiscoveryContext,
  type LatteFunctionInFlight,
} from "./latteFunctionDiscovery";
import { isLatteScanSkippedDirectory } from "./netteTemplateDiscovery";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import type { LatteProviderRequestContext } from "./latteProviderRequestContext";

const ROOT = "/ws";

interface WorkspaceEntry {
  kind: "directory" | "file";
  path: string;
}

function buildWorkspace(files: Record<string, string>, root: string = ROOT) {
  const contents = new Map<string, string>();
  const directories = new Map<string, Map<string, WorkspaceEntry>>();

  const ensureDirectory = (directory: string): void => {
    if (!directories.has(directory)) {
      directories.set(directory, new Map());
    }
  };

  for (const [relativePath, content] of Object.entries(files)) {
    contents.set(`${root}/${relativePath}`, content);

    const segments = relativePath.split("/");
    let directory = root;
    ensureDirectory(directory);

    for (let index = 0; index < segments.length; index += 1) {
      const isFile = index === segments.length - 1;
      const childPath = `${directory}/${segments[index]}`;
      directories.get(directory)?.set(childPath, {
        kind: isFile ? "file" : "directory",
        path: childPath,
      });
      directory = childPath;

      if (!isFile) {
        ensureDirectory(directory);
      }
    }
  }

  const listDirectory = vi.fn(async (path: string): Promise<WorkspaceEntry[]> => {
    const entries = directories.get(path);

    if (!entries) {
      throw new Error(`no such directory: ${path}`);
    }

    return Array.from(entries.values());
  });

  const readFileContent = vi.fn(async (path: string): Promise<string> => {
    const content = contents.get(path);

    if (content === undefined) {
      throw new Error(`no such file: ${path}`);
    }

    return content;
  });

  return { listDirectory, readFileContent };
}

function latteExtensionSource(...names: string[]): string {
  return [
    "<?php",
    "",
    "final class AppLatteExtension extends Latte\\Extension",
    "{",
    "    public function getFunctions(): array",
    "    {",
    "        return [",
    ...names.map((name) => `            '${name}' => [$this, '${name}'],`),
    "        ];",
    "    }",
    "",
    ...names.flatMap((name) => [
      `    public function ${name}(): string`,
      "    {",
      "        return '';",
      "    }",
      "",
    ]),
    "}",
    "",
  ].join("\n");
}

function latteExtensionCallable(source: string, methodName: string) {
  return {
    callableKind: "instance" as const,
    callableOffset: source.indexOf(
      methodName,
      source.indexOf(`function ${methodName}`),
    ),
    className: "AppLatteExtension",
    methodName,
    serviceClassName: "AppLatteExtension",
  };
}

function addFunctionSource(...names: string[]): string {
  return [
    "<?php",
    "",
    ...names.map(
      (name) => `$latte->addFunction('${name}', fn() => ${name}());`,
    ),
    "",
  ].join("\n");
}

function makeContext(
  files: Record<string, string>,
  overrides: Partial<LatteFunctionDiscoveryContext> = {},
) {
  const workspace = buildWorkspace(files, overrides.requestedRoot ?? ROOT);
  const cache: LatteFunctionCache = {};
  const inFlight: LatteFunctionInFlight = new Map();
  const context: LatteFunctionDiscoveryContext = {
    cache,
    deps: {
      joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
      listDirectory: workspace.listDirectory,
      readFileContent: workspace.readFileContent,
    },
    generation: 0,
    inFlight,
    isDirectorySkipped: isLatteScanSkippedDirectory,
    isRequestedRootActive: () => true,
    maxSourceFiles: 100,
    maxDepth: 12,
    requestedRoot: ROOT,
    scanDirectories: ["app", "templates"],
    ttlMs: 5_000,
    ...overrides,
  };

  return { context, workspace };
}

describe("loadLatteFunctionRegistrations", () => {
  it("discovers getFunctions map entries from PHP Latte extensions", async () => {
    const extensionSource = latteExtensionSource("money", "isEven");
    const { context } = makeContext({
      "app/Latte/AppLatteExtension.php": extensionSource,
    });

    await expect(loadLatteFunctionRegistrations(context)).resolves.toEqual([
      {
        ...latteExtensionCallable(extensionSource, "isEven"),
        name: "isEven",
        offset: extensionSource.indexOf("isEven"),
        path: `${ROOT}/app/Latte/AppLatteExtension.php`,
      },
      {
        ...latteExtensionCallable(extensionSource, "money"),
        name: "money",
        offset: extensionSource.indexOf("money"),
        path: `${ROOT}/app/Latte/AppLatteExtension.php`,
      },
    ]);
  });

  it("discovers addFunction call sites and keeps first registration per name", async () => {
    const firstSource = addFunctionSource("money");
    const secondSource = addFunctionSource("money", "shuffled");
    const { context } = makeContext({
      "app/a/TemplateFactory.php": firstSource,
      "app/b/OtherFactory.php": secondSource,
    });

    await expect(loadLatteFunctionRegistrations(context)).resolves.toEqual([
      {
        name: "money",
        offset: firstSource.indexOf("money"),
        path: `${ROOT}/app/a/TemplateFactory.php`,
      },
      {
        name: "shuffled",
        offset: secondSource.indexOf("shuffled"),
        path: `${ROOT}/app/b/OtherFactory.php`,
      },
    ]);
  });

  it("serves cached registrations within the TTL without rescanning", async () => {
    const { context, workspace } = makeContext({
      "app/Latte/AppLatteExtension.php": latteExtensionSource("money"),
    });

    await loadLatteFunctionRegistrations(context);
    const readsAfterFirstLoad = workspace.readFileContent.mock.calls.length;

    await expect(
      loadLatteFunctionRegistrations(context),
    ).resolves.toMatchObject([{ name: "money" }]);
    expect(workspace.readFileContent.mock.calls.length).toBe(
      readsAfterFirstLoad,
    );
  });

  it("rescans when the cached entry was written for an older generation", async () => {
    const { context, workspace } = makeContext({
      "app/Latte/AppLatteExtension.php": latteExtensionSource("money"),
    });

    await loadLatteFunctionRegistrations(context);
    const staleContext = { ...context, generation: 1 };

    await expect(
      loadLatteFunctionRegistrations(staleContext),
    ).resolves.toMatchObject([{ name: "money" }]);
    expect(workspace.readFileContent.mock.calls.length).toBe(2);
  });

  it("deduplicates concurrent scans through the in-flight map", async () => {
    const { context, workspace } = makeContext({
      "app/Latte/AppLatteExtension.php": latteExtensionSource("money"),
    });

    const [first, second] = await Promise.all([
      loadLatteFunctionRegistrations(context),
      loadLatteFunctionRegistrations(context),
    ]);

    expect(first).toEqual(second);
    expect(workspace.readFileContent.mock.calls.length).toBe(1);
  });

  it("drops a scan and caches nothing when the root goes stale mid-scan", async () => {
    let active = true;
    const { context, workspace } = makeContext(
      {
        "app/Latte/AppLatteExtension.php": latteExtensionSource("money"),
      },
      { isRequestedRootActive: () => active },
    );
    const listEntries = workspace.listDirectory.getMockImplementation();
    workspace.listDirectory.mockImplementation(async (path: string) => {
      active = false;

      if (!listEntries) {
        return [];
      }

      return listEntries(path);
    });

    await expect(loadLatteFunctionRegistrations(context)).resolves.toEqual([]);
    expect(context.cache[ROOT]).toBeUndefined();
  });

  it("keeps roots isolated: another root's cache never leaks names", async () => {
    const rootA = "/ws-a";
    const rootB = "/ws-b";
    const workspaceA = buildWorkspace(
      { "app/Latte/AppLatteExtension.php": latteExtensionSource("secretA") },
      rootA,
    );
    const workspaceB = buildWorkspace({}, rootB);
    const cache: LatteFunctionCache = {};
    const inFlight: LatteFunctionInFlight = new Map();
    const contextFor = (
      root: string,
      workspace: ReturnType<typeof buildWorkspace>,
    ): LatteFunctionDiscoveryContext => ({
      cache,
      deps: {
        joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
        listDirectory: workspace.listDirectory,
        readFileContent: workspace.readFileContent,
      },
      generation: 0,
      inFlight,
      isDirectorySkipped: isLatteScanSkippedDirectory,
      isRequestedRootActive: () => true,
      maxSourceFiles: 100,
      maxDepth: 12,
      requestedRoot: root,
      scanDirectories: ["app", "templates"],
      ttlMs: 5_000,
    });

    await expect(
      loadLatteFunctionRegistrations(contextFor(rootA, workspaceA)),
    ).resolves.toMatchObject([{ name: "secretA" }]);
    await expect(
      loadLatteFunctionRegistrations(contextFor(rootB, workspaceB)),
    ).resolves.toEqual([]);
  });

  it("skips vendor-style directories and oversized sources", async () => {
    const oversized = `${latteExtensionSource("hugeFn")}\n// ${"x".repeat(1024 * 1024)}`;
    const { context } = makeContext({
      "app/Latte/AppLatteExtension.php": latteExtensionSource("money"),
      "app/Latte/HugeExtension.php": oversized,
      "app/vendor/package/VendorExtension.php": latteExtensionSource("vendorFn"),
    });

    await expect(
      loadLatteFunctionRegistrations(context),
    ).resolves.toMatchObject([{ name: "money" }]);
  });

  it("stops scanning once the source-file budget is reached", async () => {
    const { context, workspace } = makeContext(
      {
        "app/a/AExtension.php": latteExtensionSource("aFn"),
        "app/b/BExtension.php": latteExtensionSource("bFn"),
      },
      { maxSourceFiles: 1 },
    );

    await loadLatteFunctionRegistrations(context);

    expect(workspace.readFileContent).toHaveBeenCalledTimes(1);
  });
});

describe("latteFunctionDiscoveryContext", () => {
  function flowOptions(): LatteProviderFlowFactoryOptions {
    return {
      caches: {
        componentCache: {},
        filterCache: {},
        factoryTemplateOwnerCache: {},
        factoryTemplateOwnerGeneration: { next: 0, roots: {} },
        includeArgumentCache: {},
        includeArgumentGenerationByRoot: {},
        presenterCache: {},
        presenterMappingCache: {},
        presenterMappingGeneration: { next: 0, roots: {} },
        templateCache: {},
        templateTypeCache: {},
        viewDataCache: {},
      },
      frameworkCapabilities: {} as never,
      getDependencies: vi.fn(),
      inFlight: {
        filterInFlight: new Map(),
        factoryTemplateOwnerInFlight: new Map(),
        includeArgumentInFlight: { graphs: new Map(), queries: new Map() },
        presenterInFlight: new Map(),
        presenterMappingInFlight: new Map(),
        templateTypeInFlight: new Map(),
        viewDataInFlight: new Map(),
      },
    };
  }

  function requestContext(root: string): LatteProviderRequestContext {
    return {
      currentTemplateRelativePath: "app/UI/Home/default.latte",
      deps: {
        joinPath: (rootPath: string, relativePath: string) =>
          `${rootPath}/${relativePath}`,
        listDirectory: vi.fn(async () => []),
        readFileContent: vi.fn(async () => ""),
      } as unknown as LatteProviderRequestContext["deps"],
      isRequestedRootActive: () => true,
      loadFactoryTemplateOwner: async () => null,
      requestedRoot: root,
    };
  }

  it("shares one cache per flow caches object and evicts other roots", async () => {
    const options = flowOptions();
    const first = latteFunctionDiscoveryContext(options, requestContext("/ws-a"));
    first.cache["/ws-a"] = {
      expiresAt: Date.now() + 60_000,
      generation: first.generation,
      registrations: [],
    };

    const again = latteFunctionDiscoveryContext(
      options,
      requestContext("/ws-a"),
    );
    expect(again.cache["/ws-a"]).toBeDefined();

    const otherRoot = latteFunctionDiscoveryContext(
      options,
      requestContext("/ws-b"),
    );
    expect(otherRoot.cache["/ws-a"]).toBeUndefined();
  });

  it("drops cache entries stamped with an outdated generation", () => {
    const options = flowOptions();
    const first = latteFunctionDiscoveryContext(options, requestContext("/ws"));
    first.cache["/ws"] = {
      expiresAt: Date.now() + 60_000,
      generation: first.generation,
      registrations: [],
    };
    options.caches.includeArgumentGenerationByRoot["/ws"] =
      first.generation + 1;

    const bumped = latteFunctionDiscoveryContext(options, requestContext("/ws"));

    expect(bumped.cache["/ws"]).toBeUndefined();
    expect(bumped.generation).toBe(first.generation + 1);
  });

  it("guards the context against a stale requested root", () => {
    const options = flowOptions();
    let active = true;
    const request = requestContext("/ws");
    request.isRequestedRootActive = () => active;

    const context = latteFunctionDiscoveryContext(options, request);
    expect(context.isRequestedRootActive()).toBe(true);

    active = false;
    expect(context.isRequestedRootActive()).toBe(false);
  });
});
