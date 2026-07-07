import { describe, expect, it, vi } from "vitest";
import {
  evictOtherRootConfigCacheEntries,
  loadNeonProjectConfig,
  resolveNeonServiceTypeFromMaps,
  type NeonConfigCache,
  type NeonConfigInFlight,
  type NeonProjectConfigDirectoryEntry,
  type NeonProjectConfigRequestContext,
} from "./neonProjectConfigDiscovery";

const ROOT = "/ws";

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

  return { listDirectory, readFileContent };
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
      "/a": { config: { ...emptyConfig() }, expiresAt: Date.now() + 1_000 },
      "/b": { config: { ...emptyConfig() }, expiresAt: Date.now() + 1_000 },
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
