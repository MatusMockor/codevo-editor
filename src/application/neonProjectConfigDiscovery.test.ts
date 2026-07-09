import { describe, expect, it, vi } from "vitest";
import {
  evictOtherRootConfigCacheEntries,
  invalidateNeonConfigCacheForPath,
  loadNeonProjectConfig,
  resolveNeonServiceTypeFromMaps,
  type NeonConfigCache,
  type NeonConfigInFlight,
  type NeonProjectConfigDirectoryEntry,
  type NeonProjectConfigRequestContext,
} from "./neonProjectConfigDiscovery";

const ROOT = "/ws";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function buildNeonWorkspace(
  sources: Record<string, string>,
  root: string = ROOT,
) {
  const fileContents = new Map<string, string>();
  const directories = new Map<string, Map<string, NeonProjectConfigDirectoryEntry>>();

  const ensureDirectory = (directory: string): void => {
    if (!directories.has(directory)) {
      directories.set(directory, new Map());
    }
  };

  for (const [relativePath, content] of Object.entries(sources)) {
    const absolute = `${root}/${relativePath}`;
    fileContents.set(absolute, content);

    const segments = relativePath.split("/");
    let directory = root;
    ensureDirectory(directory);

    for (let index = 0; index < segments.length; index += 1) {
      const isFile = index === segments.length - 1;
      const childPath = `${directory}/${segments[index]}`;
      ensureDirectory(directory);
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

  const listDirectory = vi.fn(
    async (path: string): Promise<NeonProjectConfigDirectoryEntry[]> => {
      const entries = directories.get(path);

      if (!entries) {
        throw new Error(`no such directory: ${path}`);
      }

      return Array.from(entries.values());
    },
  );
  const readFileContent = vi.fn(async (path: string): Promise<string> => {
    const content = fileContents.get(path);

    if (content === undefined) {
      throw new Error(`no such file: ${path}`);
    }

    return content;
  });
  const setFileContent = (relativePath: string, content: string): void => {
    fileContents.set(`${root}/${relativePath}`, content);
  };

  return { listDirectory, readFileContent, setFileContent };
}

function makeContext(
  overrides: Partial<
    NeonProjectConfigRequestContext["deps"] & {
      cache: NeonConfigCache;
      currentRoot: string | null;
      inFlight: NeonConfigInFlight;
      root: string;
    }
  > = {},
): NeonProjectConfigRequestContext {
  const requestedRoot = overrides.root ?? ROOT;
  const currentRootRef = { current: overrides.currentRoot ?? requestedRoot };
  const deps = {
    getActiveDocument:
      overrides.getActiveDocument ??
      (() => ({ path: `${requestedRoot}/config/config.neon` })),
    joinPath:
      overrides.joinPath ??
      ((rootPath: string, relativePath: string) => `${rootPath}/${relativePath}`),
    listDirectory:
      overrides.listDirectory ??
      vi.fn(async () => {
        throw new Error("no directory");
      }),
    readFileContent:
      overrides.readFileContent ??
      vi.fn(async () => {
        throw new Error("missing");
      }),
  };

  return {
    configCache: overrides.cache ?? {},
    configInFlight: overrides.inFlight ?? new Map(),
    deps,
    isRequestedRootActive: () => currentRootRef.current === requestedRoot,
    requestedRoot,
  };
}

describe("loadNeonProjectConfig", () => {
  it("loads parameters and services from conventional and module config files", async () => {
    const workspace = buildNeonWorkspace({
      "app/config/local.neon": "parameters:\n    appSecret: local\n",
      "app/modules/paymentsModule/config/config.neon":
        "services:\n    paymentGateway: App\\Payments\\Gateway\n",
      "config/config.neon":
        "parameters:\n    dbHost: localhost\nservices:\n    mailer: App\\Mail\\Mailer\n",
    });

    const config = await loadNeonProjectConfig(
      makeContext({
        listDirectory: workspace.listDirectory,
        readFileContent: workspace.readFileContent,
      }),
    );

    expect(config.parameterNames).toEqual(["appSecret", "dbHost"]);
    expect(config.serviceNames).toContain("mailer");
    expect(config.serviceNames).toContain("paymentGateway");
    expect(config.serviceNameTypes.get("mailer")).toBe("App\\Mail\\Mailer");
    expect(config.serviceNameTypes.get("paymentGateway")).toBe(
      "App\\Payments\\Gateway",
    );
  });

  it("keeps the first definition for duplicated parameters and services", async () => {
    const workspace = buildNeonWorkspace({
      "config/a.neon":
        "parameters:\n    dsn: first\nservices:\n    logger: App\\FirstLogger\n",
      "config/b.neon":
        "parameters:\n    dsn: second\nservices:\n    logger: App\\SecondLogger\n",
    });

    const config = await loadNeonProjectConfig(
      makeContext({
        listDirectory: workspace.listDirectory,
        readFileContent: workspace.readFileContent,
      }),
    );

    expect(config.parameters.get("dsn")?.path).toBe(`${ROOT}/config/a.neon`);
    expect(config.services.get("logger")?.path).toBe(`${ROOT}/config/a.neon`);
    expect(config.serviceNameTypes.get("logger")).toBe("App\\FirstLogger");
  });

  it("shares in-flight scans for the same root", async () => {
    const workspace = buildNeonWorkspace({
      "config/config.neon": "parameters:\n    dbHost: localhost\n",
    });
    const context = makeContext({
      inFlight: new Map(),
      listDirectory: workspace.listDirectory,
      readFileContent: workspace.readFileContent,
    });

    const [left, right] = await Promise.all([
      loadNeonProjectConfig(context),
      loadNeonProjectConfig(context),
    ]);

    expect(left).toBe(right);
    expect(workspace.readFileContent).toHaveBeenCalledTimes(1);
  });

  it("does not let an invalidated in-flight scan overwrite a newer cached scan", async () => {
    const cache: NeonConfigCache = {};
    const inFlight: NeonConfigInFlight = new Map();
    const staleReadStarted = createDeferred();
    const releaseStaleRead = createDeferred();
    let readCount = 0;
    let content = "parameters:\n    staleOnly: old\n";
    const workspace = buildNeonWorkspace({
      "config/config.neon": content,
    });
    const context = makeContext({
      cache,
      inFlight,
      listDirectory: workspace.listDirectory,
      readFileContent: vi.fn(async (path: string): Promise<string> => {
        readCount += 1;

        if (readCount === 1) {
          staleReadStarted.resolve();
          await releaseStaleRead.promise;

          return "parameters:\n    staleOnly: old\n";
        }

        if (path !== `${ROOT}/config/config.neon`) {
          throw new Error(`no such file: ${path}`);
        }

        return content;
      }),
    });

    const staleScan = loadNeonProjectConfig(context);
    await staleReadStarted.promise;

    invalidateNeonConfigCacheForPath(
      cache,
      inFlight,
      ROOT,
      `${ROOT}/config/config.neon`,
    );
    content = "parameters:\n    freshOnly: new\n";

    const freshScan = await loadNeonProjectConfig(context);
    expect(freshScan.parameterNames).toEqual(["freshOnly"]);

    releaseStaleRead.resolve();
    const staleResult = await staleScan;

    expect(staleResult.parameterNames).toEqual(["staleOnly"]);
    expect(cache[ROOT]?.config.parameterNames).toEqual(["freshOnly"]);
    expect(await loadNeonProjectConfig(context)).toBe(freshScan);
  });

  it("drops stale results and does not write cache when the root changes after awaits", async () => {
    const cache: NeonConfigCache = {};
    const workspace = buildNeonWorkspace({
      "config/config.neon": "parameters:\n    dbHost: localhost\n",
    });
    let activeRoot = ROOT;
    const context: NeonProjectConfigRequestContext = {
      configCache: cache,
      configInFlight: new Map(),
      deps: {
        getActiveDocument: () => ({ path: `${ROOT}/config/config.neon` }),
        joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
        listDirectory: async (path) => {
          activeRoot = "/other";

          return workspace.listDirectory(path);
        },
        readFileContent: workspace.readFileContent,
      },
      isRequestedRootActive: () => activeRoot === ROOT,
      requestedRoot: ROOT,
    };

    const config = await loadNeonProjectConfig(context);

    expect(config.parameterNames).toEqual([]);
    expect(cache[ROOT]).toBeUndefined();
  });

  it("reloads cached project config after explicit NEON file invalidation", async () => {
    const cache: NeonConfigCache = {};
    const inFlight: NeonConfigInFlight = new Map();
    const workspace = buildNeonWorkspace({
      "config/config.neon": "parameters:\n    dbHost: localhost\n",
    });
    const context = makeContext({
      cache,
      inFlight,
      listDirectory: workspace.listDirectory,
      readFileContent: workspace.readFileContent,
    });

    const first = await loadNeonProjectConfig(context);
    workspace.setFileContent(
      "config/config.neon",
      "parameters:\n    dbHost: remote\n    dbPassword: secret\n",
    );
    const cached = await loadNeonProjectConfig(context);

    expect(cached).toBe(first);
    expect(cached.parameterNames).toEqual(["dbHost"]);

    invalidateNeonConfigCacheForPath(
      cache,
      inFlight,
      ROOT,
      `${ROOT}/config/config.neon`,
    );

    const reloaded = await loadNeonProjectConfig(context);

    expect(reloaded).not.toBe(first);
    expect(reloaded.parameterNames).toEqual(["dbHost", "dbPassword"]);
  });

  it("loads and refreshes recursively included NEON files outside scan directories", async () => {
    const cache: NeonConfigCache = {};
    const inFlight: NeonConfigInFlight = new Map();
    const workspace = buildNeonWorkspace({
      "config/config.neon": "includes:\n    - ../shared/parameters\n",
      "shared/parameters.neon": "parameters:\n    apiToken: first\n",
    });
    const context = makeContext({
      cache,
      inFlight,
      listDirectory: workspace.listDirectory,
      readFileContent: workspace.readFileContent,
    });

    const config = await loadNeonProjectConfig(context);

    expect(config.parameterNames).toEqual(["apiToken"]);
    expect(config.parameters.get("apiToken")?.path).toBe(
      `${ROOT}/shared/parameters.neon`,
    );

    workspace.setFileContent(
      "shared/parameters.neon",
      "parameters:\n    apiToken: second\n    apiSecret: fresh\n",
    );
    invalidateNeonConfigCacheForPath(
      cache,
      inFlight,
      ROOT,
      `${ROOT}/shared/parameters.neon`,
    );

    const refreshed = await loadNeonProjectConfig(context);

    expect(refreshed.parameterNames).toEqual(["apiSecret", "apiToken"]);
  });

  it("discovers includes and invalidates cache for native backslash paths", async () => {
    const root = "C:\\workspace";
    const cache: NeonConfigCache = {};
    const inFlight: NeonConfigInFlight = new Map();
    const fileContents = new Map([
      [
        "C:/workspace/config/config.neon",
        "includes:\n    - ..\\shared\\parameters\n",
      ],
      [
        "C:/workspace/shared/parameters.neon",
        "parameters:\n    apiToken: first\n",
      ],
    ]);
    const normalize = (path: string): string => path.split("\\").join("/");
    const context = makeContext({
      cache,
      currentRoot: root,
      getActiveDocument: () => ({
        path: "C:\\workspace\\config\\config.neon",
      }),
      inFlight,
      joinPath: (rootPath, relativePath) => `${rootPath}\\${relativePath}`,
      listDirectory: vi.fn(
        async (path): Promise<NeonProjectConfigDirectoryEntry[]> => {
          const normalized = normalize(path);

          if (normalized === "C:/workspace/config") {
            return [
              {
                kind: "file",
                path: "C:\\workspace\\config\\config.neon",
              },
            ];
          }

          throw new Error(`no such directory: ${path}`);
        },
      ),
      readFileContent: vi.fn(async (path) => {
        const content = fileContents.get(normalize(path));

        if (content === undefined) {
          throw new Error(`no such file: ${path}`);
        }

        return content;
      }),
      root,
    });

    const config = await loadNeonProjectConfig(context);

    expect(config.parameterNames).toEqual(["apiToken"]);
    expect(config.parameters.get("apiToken")?.path).toBe(
      "C:/workspace/shared/parameters.neon",
    );

    fileContents.set(
      "C:/workspace/shared/parameters.neon",
      "parameters:\n    apiToken: second\n    apiSecret: fresh\n",
    );
    invalidateNeonConfigCacheForPath(
      cache,
      inFlight,
      root,
      "C:\\workspace\\shared\\parameters.neon",
    );

    const refreshed = await loadNeonProjectConfig(context);

    expect(refreshed.parameterNames).toEqual(["apiSecret", "apiToken"]);
  });
});

describe("NEON project config service helpers", () => {
  it("resolves alias chains and stops alias cycles", () => {
    expect(
      resolveNeonServiceTypeFromMaps(
        "mail",
        new Map([["mailer", "App\\Mail\\Mailer"]]),
        new Map([
          ["mail", "smtp"],
          ["smtp", "mailer"],
        ]),
      ),
    ).toBe("App\\Mail\\Mailer");

    expect(
      resolveNeonServiceTypeFromMaps(
        "a",
        new Map(),
        new Map([
          ["a", "b"],
          ["b", "a"],
        ]),
      ),
    ).toBeNull();
  });

  it("evicts cached roots except the requested root", () => {
    const cache: NeonConfigCache = {
      "/a": {
        config: { ...emptyConfig() },
        expiresAt: Date.now() + 1_000,
      },
      "/b": {
        config: { ...emptyConfig() },
        expiresAt: Date.now() + 1_000,
      },
    };

    evictOtherRootConfigCacheEntries(cache, "/b");

    expect(Object.keys(cache)).toEqual(["/b"]);
  });
});

function emptyConfig() {
  return {
    parameterNames: [],
    parameters: new Map(),
    serviceAliases: new Map(),
    serviceNameTypes: new Map(),
    serviceNames: [],
    services: new Map(),
    serviceTypes: new Map(),
  };
}
