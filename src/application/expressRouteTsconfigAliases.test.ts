import { describe, expect, it, vi } from "vitest";
import type {
  BoundedWorkspaceSourceRead,
  WorkspaceSourceDiscoveryGateway,
} from "../domain/workspaceSourceDiscovery";
import { readExpressRouteTsconfigAliases } from "./expressRouteTsconfigAliases";

const ROOT = "/workspace";
const IMPORTER = { relativeFilePath: "packages/api/src/app.ts" } as const;

describe("readExpressRouteTsconfigAliases", () => {
  it("uses root aliases for every package with a confirmed-missing local config", async () => {
    const packageDirectories = Array.from({ length: 32 }, (_, index) => `packages/p${index}`);
    const configs: ConfigResponses = {
      "tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["shared/routes"]}}}',
    };
    for (const directory of packageDirectories) {
      configs[`${directory}/tsconfig.json`] = { status: "notFound" };
    }
    const gateway = configGateway(configs);

    const result = await readAliases(gateway, () => true, packageDirectories);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    for (const directory of packageDirectories) {
      expect(
        result.importPathResolver?.("@routes", {
          relativeFilePath: `${directory}/src/app.ts`,
        }),
      ).toEqual(["shared/routes"]);
    }
    expect(result.truncated).toBe(false);
  });

  it("treats changed then notFound as a stable missing package config", async () => {
    let attempts = 0;
    const gateway = configGateway({
      "packages/api/tsconfig.json": () => {
        attempts += 1;
        return attempts === 1 ? { status: "changed" } : { status: "notFound" };
      },
      "tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["shared/routes"]}}}',
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(attempts).toBe(2);
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["shared/routes"]);
    expect(result.truncated).toBe(false);
  });

  it("falls through a missing nested config to the nearest configured ancestor", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": { status: "notFound" },
      "packages/tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["shared/routes"]}}}',
      "tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["root/routes"]}}}',
    });

    const result = await readAliases(gateway, () => true, ["packages", "packages/api"]);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/shared/routes"]);
    expect(result.truncated).toBe(false);
  });

  it("publishes no resolver when root and package configs are both missing", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": { status: "notFound" },
      "tsconfig.json": { status: "notFound" },
    });

    const result = await readAliases(gateway);

    expect(result).toMatchObject({ status: "current", truncated: false });
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
  });

  it("keeps a valid package resolver when the root config is missing", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["src/routes"]}}}',
      "tsconfig.json": { status: "notFound" },
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
  });

  it("loads an explicit workspace root tsconfig.base.json on demand", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"../../tsconfig.base.json"}',
      "tsconfig.base.json":
        '{"compilerOptions":{"baseUrl":"packages/api","paths":{"@routes":["src/routes"]}}}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT,
      "tsconfig.base.json",
      256 * 1024,
    );
  });

  it("loads a same-package shared config without creating a new importer scope", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"./tsconfig.shared.json"}',
      "packages/api/tsconfig.shared.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["src/routes"]}}}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(
      result.importPathResolver?.("@routes", {
        relativeFilePath: "packages/api-other/src/app.ts",
      }),
    ).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("appends .json for a confined extensionless relative config", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"./tsconfig.shared"}',
      "packages/api/tsconfig.shared.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["src/routes"]}}}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT,
      "packages/api/tsconfig.shared.json",
      256 * 1024,
    );
  });

  it("preserves inherited baseUrl provenance across a three-level chain", async () => {
    const gateway = configGateway({
      "configs/tsconfig.mid.json": '{"extends":"../tsconfig.base.json"}',
      "packages/api/tsconfig.json":
        '{"extends":"../../configs/tsconfig.mid.json","compilerOptions":{"paths":{"@routes":["src/routes"]}}}',
      "tsconfig.base.json": '{"compilerOptions":{"baseUrl":"packages/api"}}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
  });

  it.each([
    ["malformed", { status: "ok", content: "{ malformed" } as const],
    ["too large", { status: "tooLarge" } as const],
    ["confirmed missing", { status: "notFound" } as const],
  ])("fails the dependent package closed when its dynamic parent is %s", async (_name, failure) => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"./tsconfig.shared.json"}',
      "packages/api/tsconfig.shared.json": failure,
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["packages/api/src/routes"]}}}',
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("keeps an ambiguous package-config read error as a tombstone", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": () => {
        throw new Error("ambiguous I/O error");
      },
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["packages/api/src/routes"]}}}',
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("retries a changed dynamic parent once and then fails closed", async () => {
    let attempts = 0;
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"./tsconfig.shared.json"}',
      "packages/api/tsconfig.shared.json": () => {
        attempts += 1;
        return { status: "changed" };
      },
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["packages/api/src/routes"]}}}',
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(attempts).toBe(2);
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("treats a cached missing root config as fatal when a package explicitly extends it", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"../../tsconfig.json"}',
      "tsconfig.json": { status: "notFound" },
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("detects cycles across dynamically loaded configs", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"./tsconfig.a.json"}',
      "packages/api/tsconfig.a.json": '{"extends":"./tsconfig.b.json"}',
      "packages/api/tsconfig.b.json": '{"extends":"./tsconfig.a.json"}',
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["packages/api/src/routes"]}}}',
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it.each([
    ["a package specifier", "@company/tsconfig/base"],
    ["a disguised dot-prefixed target", ".tsconfig.shared.json"],
    ["a dependency target", "../node_modules/tsconfig.base.json"],
    ["a workspace escape", "../../../tsconfig.base.json"],
  ])("rejects %s without reading outside the supported authority", async (_name, target) => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": JSON.stringify({ extends: target }),
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["packages/api/src/routes"]}}}',
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledTimes(2);
  });

  it("shares the aggregate byte budget with dynamically loaded parents", async () => {
    const configs: ConfigResponses = {
      "packages/api/tsconfig.json": '{"extends":"./tsconfig.shared-00.json"}',
      "tsconfig.json": "{}",
    };
    for (let index = 0; index < 17; index += 1) {
      const current = index.toString().padStart(2, "0");
      const next = (index + 1).toString().padStart(2, "0");
      configs[`packages/api/tsconfig.shared-${current}.json`] = JSON.stringify({
        ...(index < 16
          ? { extends: `./tsconfig.shared-${next}.json` }
          : {
              compilerOptions: {
                baseUrl: ".",
                paths: { "@routes": ["src/routes"] },
              },
            }),
        padding: "x".repeat(247_000),
      });
    }
    const gateway = configGateway(configs);

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("drops a dynamic-parent result when the exact owner becomes stale", async () => {
    const parent = deferred<BoundedWorkspaceSourceRead>();
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"./tsconfig.shared.json"}',
      "packages/api/tsconfig.shared.json": () => parent.promise,
      "tsconfig.json": "{}",
    });
    let current = true;
    const pending = readAliases(gateway, () => current);
    await vi.waitFor(() =>
      expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
        ROOT,
        "packages/api/tsconfig.shared.json",
        256 * 1024,
      ),
    );

    current = false;
    parent.resolve({
      status: "ok",
      content: '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["src/routes"]}}}',
    });

    await expect(pending).resolves.toEqual({ status: "stale" });
  });

  it("drops a confirmed-missing package config when its owner becomes stale", async () => {
    const packageConfig = deferred<BoundedWorkspaceSourceRead>();
    const gateway = configGateway({
      "packages/api/tsconfig.json": () => packageConfig.promise,
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["packages/api/src/routes"]}}}',
    });
    let current = true;
    const pending = readAliases(gateway, () => current);
    await vi.waitFor(() =>
      expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
        ROOT,
        "packages/api/tsconfig.json",
        256 * 1024,
      ),
    );

    current = false;
    packageConfig.resolve({ status: "notFound" });

    await expect(pending).resolves.toEqual({ status: "stale" });
  });
});

type ConfigResponse =
  | string
  | BoundedWorkspaceSourceRead
  | (() => BoundedWorkspaceSourceRead | Promise<BoundedWorkspaceSourceRead>);
type ConfigResponses = Record<string, ConfigResponse>;

function configGateway(configs: ConfigResponses): WorkspaceSourceDiscoveryGateway {
  return {
    enumerateJavaScriptSourceFiles: vi.fn(async () => ({
      files: [],
      truncated: false,
      visited: 0,
    })),
    readSourceTextBounded: vi.fn(async (_root, relativePath) => {
      const response = configs[relativePath];
      if (typeof response === "function") return response();
      if (typeof response === "string") {
        return { status: "ok" as const, content: response };
      }
      return response ?? { status: "tooLarge" as const };
    }),
  };
}

function readAliases(
  gateway: WorkspaceSourceDiscoveryGateway,
  isCurrent: () => boolean = () => true,
  packageDirectories: readonly string[] = ["packages/api"],
) {
  return readExpressRouteTsconfigAliases({
    allowUnscopedRoot: true,
    gateway,
    incompleteDirectories: [],
    isCurrent,
    packageDirectories,
    rootPath: ROOT,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
