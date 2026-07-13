import { describe, expect, it, vi } from "vitest";
import {
  loadLatteFilterNames,
  loadLatteFilterRegistrations,
  type LatteFilterCache,
  type LatteFilterDiscoveryContext,
  type LatteFilterInFlight,
} from "./latteFilterDiscovery";
import { isLatteScanSkippedDirectory } from "./netteTemplateDiscovery";

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

function filterLoaderConfig(...names: string[]): string {
  return [
    "services:",
    "    filterLoader:",
    "        setup:",
    ...names.map((name) => `            - register('${name}', [@helper, process])`),
    "",
  ].join("\n");
}

function latteExtensionSource(...names: string[]): string {
  return [
    "<?php",
    "",
    "final class AppLatteExtension extends Latte\\Extension",
    "{",
    "    public function getFilters(): array",
    "    {",
    "        return [",
    ...names.map((name) => `            '${name}' => [$this, '${name}'],`),
    "        ];",
    "    }",
    "}",
    "",
  ].join("\n");
}

function makeContext(
  files: Record<string, string>,
  overrides: Partial<LatteFilterDiscoveryContext> = {},
) {
  const workspace = buildWorkspace(files, overrides.requestedRoot ?? ROOT);
  const cache: LatteFilterCache = {};
  const inFlight: LatteFilterInFlight = new Map();
  const context: LatteFilterDiscoveryContext = {
    cache,
    deps: {
      joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
      listDirectory: workspace.listDirectory,
      readFileContent: workspace.readFileContent,
    },
    inFlight,
    isDirectorySkipped: isLatteScanSkippedDirectory,
    isRequestedRootActive: () => true,
    maxConfigFiles: 100,
    maxDepth: 12,
    requestedRoot: ROOT,
    scanDirectories: ["app", "templates"],
    ttlMs: 5_000,
    ...overrides,
  };

  return { context, workspace };
}

describe("loadLatteFilterRegistrations", () => {
  it("aggregates unique names across neon files keeping the first location", async () => {
    const usersConfig = filterLoaderConfig("gravatar", "userLabel");
    const appConfig = filterLoaderConfig("userDate", "gravatar");
    const { context } = makeContext({
      "app/modules/applicationModule/config/config.neon": appConfig,
      "app/modules/usersModule/config/config.neon": usersConfig,
    });

    await expect(loadLatteFilterRegistrations(context)).resolves.toEqual([
      {
        name: "gravatar",
        offset: appConfig.indexOf("gravatar"),
        path: `${ROOT}/app/modules/applicationModule/config/config.neon`,
      },
      {
        name: "userDate",
        offset: appConfig.indexOf("userDate"),
        path: `${ROOT}/app/modules/applicationModule/config/config.neon`,
      },
      {
        name: "userLabel",
        offset: usersConfig.indexOf("userLabel"),
        path: `${ROOT}/app/modules/usersModule/config/config.neon`,
      },
    ]);
  });

  it("serves the cached names within the TTL without rescanning", async () => {
    const { context, workspace } = makeContext({
      "app/config/config.neon": filterLoaderConfig("userDate"),
    });

    await loadLatteFilterNames(context);
    const readsAfterFirstLoad = workspace.readFileContent.mock.calls.length;

    await expect(loadLatteFilterNames(context)).resolves.toEqual(["userDate"]);
    expect(workspace.readFileContent.mock.calls.length).toBe(readsAfterFirstLoad);
    expect(workspace.listDirectory.mock.calls.length).toBe(3);
  });

  it("deduplicates concurrent scans through the in-flight map", async () => {
    const { context, workspace } = makeContext({
      "app/config/config.neon": filterLoaderConfig("userDate"),
    });

    const [first, second] = await Promise.all([
      loadLatteFilterRegistrations(context),
      loadLatteFilterRegistrations(context),
    ]);

    expect(first).toEqual(second);
    expect(workspace.readFileContent.mock.calls.length).toBe(1);
  });

  it("drops a scan and caches nothing when the root goes stale mid-scan", async () => {
    let active = true;
    const { context, workspace } = makeContext(
      {
        "app/config/config.neon": filterLoaderConfig("userDate"),
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

    await expect(loadLatteFilterRegistrations(context)).resolves.toEqual([]);
    expect(context.cache[ROOT]).toBeUndefined();
  });

  it("keeps roots isolated: another root's cache never leaks names", async () => {
    const rootA = "/ws-a";
    const rootB = "/ws-b";
    const workspaceA = buildWorkspace(
      { "app/config/config.neon": filterLoaderConfig("secretA") },
      rootA,
    );
    const workspaceB = buildWorkspace({}, rootB);
    const cache: LatteFilterCache = {};
    const inFlight: LatteFilterInFlight = new Map();
    const contextFor = (
      root: string,
      workspace: ReturnType<typeof buildWorkspace>,
    ): LatteFilterDiscoveryContext => ({
      cache,
      deps: {
        joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
        listDirectory: workspace.listDirectory,
        readFileContent: workspace.readFileContent,
      },
      inFlight,
      isDirectorySkipped: isLatteScanSkippedDirectory,
      isRequestedRootActive: () => true,
      maxConfigFiles: 100,
      maxDepth: 12,
      requestedRoot: root,
      scanDirectories: ["app", "templates"],
      ttlMs: 5_000,
    });

    await expect(
      loadLatteFilterNames(contextFor(rootA, workspaceA)),
    ).resolves.toEqual(["secretA"]);
    await expect(
      loadLatteFilterNames(contextFor(rootB, workspaceB)),
    ).resolves.toEqual([]);
  });

  it("discovers literal keys returned from PHP Latte Extension getFilters()", async () => {
    const extensionSource = latteExtensionSource("money", "userLabel");
    const { context } = makeContext({
      "app/Latte/AppLatteExtension.php": extensionSource,
    });

    await expect(loadLatteFilterRegistrations(context)).resolves.toEqual([
      {
        name: "money",
        offset: extensionSource.indexOf("money"),
        path: `${ROOT}/app/Latte/AppLatteExtension.php`,
      },
      {
        name: "userLabel",
        offset: extensionSource.indexOf("userLabel"),
        path: `${ROOT}/app/Latte/AppLatteExtension.php`,
      },
    ]);
  });

  it("keeps NEON registrations ahead of PHP getFilters() duplicates", async () => {
    const configSource = filterLoaderConfig("money");
    const extensionSource = latteExtensionSource("money", "userLabel");
    const { context } = makeContext({
      "app/Latte/AppLatteExtension.php": extensionSource,
      "app/config/config.neon": configSource,
    });

    await expect(loadLatteFilterRegistrations(context)).resolves.toEqual([
      {
        name: "money",
        offset: configSource.indexOf("money"),
        path: `${ROOT}/app/config/config.neon`,
      },
      {
        name: "userLabel",
        offset: extensionSource.indexOf("userLabel"),
        path: `${ROOT}/app/Latte/AppLatteExtension.php`,
      },
    ]);
  });

  it("skips vendor-style directories and non-neon files", async () => {
    const { context, workspace } = makeContext({
      "app/config/config.neon": filterLoaderConfig("userDate"),
      "app/config/readme.md": "not neon",
      "app/node_modules/package/Extension.php": latteExtensionSource("nodeFilter"),
      "app/src/readme.md": "not php",
      "app/vendor/package/config.neon": filterLoaderConfig("vendorFilter"),
      "app/vendor/package/Extension.php": latteExtensionSource("vendorFilter"),
    });

    await expect(loadLatteFilterNames(context)).resolves.toEqual(["userDate"]);
    expect(workspace.readFileContent).toHaveBeenCalledTimes(1);
  });

  it("stops scanning once the config-file budget is reached", async () => {
    const { context, workspace } = makeContext(
      {
        "app/a/config.neon": filterLoaderConfig("aFilter"),
        "app/b/config.neon": filterLoaderConfig("bFilter"),
      },
      { maxConfigFiles: 1 },
    );

    await loadLatteFilterNames(context);

    expect(workspace.readFileContent).toHaveBeenCalledTimes(1);
  });
});
