import { describe, expect, it, vi } from "vitest";
import type {
  BoundedWorkspaceSourceRead,
  WorkspaceSourceDiscoveryGateway,
} from "../domain/workspaceSourceDiscovery";
import { createWorkspacePackageGraph } from "../domain/workspacePackageGraph";
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

  it("resolves a package-name extends through a symlinked workspace package", async () => {
    const gateway = configGateway({
      "node_modules/@repo/tsconfig/base.json": () => {
        throw new Error("Too many levels of symbolic links");
      },
      "packages/tsconfig/base.json":
        '{"compilerOptions":{"baseUrl":"../api","paths":{"@routes":["src/routes"]}}}',
      "packages/api/tsconfig.json": '{"extends":"@repo/tsconfig/base.json"}',
      "packages/node_modules/@repo/tsconfig/base.json": { status: "notFound" },
      "packages/api/node_modules/@repo/tsconfig/base.json": () => {
        throw new Error("Too many levels of symbolic links");
      },
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway, () => true, ["packages/api"], workspaceGraph());

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT,
      "node_modules/@repo/tsconfig/base.json",
      256 * 1024,
    );
  });

  it("resolves a bare package-name extends from a tsconfig-only workspace package", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"@repo/tsconfig"}',
      "packages/tsconfig/package.json": { status: "notFound" },
      "packages/tsconfig/tsconfig.json":
        '{"compilerOptions":{"baseUrl":"../api","paths":{"@routes":["src/routes"]}}}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway, () => true, ["packages/api"], workspaceGraph());

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
  });

  it("uses a workspace package tsconfig instead of its source entry for a bare extends", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"@repo/config"}',
      "packages/config/package.json": { status: "notFound" },
      "packages/config/tsconfig.json":
        '{"compilerOptions":{"baseUrl":"../api","paths":{"@routes":["src/routes"]}}}',
      "packages/config/src/index.ts": "{ invalid tsconfig",
      "tsconfig.json": "{}",
    });
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { name: "@repo/config" },
          relativeDirPath: "packages/config",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: ["packages/config/src/index.ts"],
    });

    const result = await readAliases(gateway, () => true, ["packages/api"], graph);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT,
      "packages/config/src/index.ts",
      256 * 1024,
    );
  });

  it.each([
    ["main", { main: "src/index.js" }],
    ["exports", { exports: { ".": "./index.js" } }],
  ])(
    "falls back from a workspace package %s entry to its tsconfig and preserves own paths",
    async (entryKind, packageEntry) => {
      const gateway = configGateway({
        "packages/api/tsconfig.json":
          '{"extends":"@repo/config","compilerOptions":{"paths":{"ownAlias":["src/own"]}}}',
        "packages/config/index.js": "module.exports = {};",
        "packages/config/index.js.json": { status: "notFound" },
        "packages/config/index.js/tsconfig.json": { status: "notFound" },
        "packages/config/package.json": JSON.stringify({
          name: "@repo/config",
          ...packageEntry,
        }),
        "packages/config/src/index.js": "module.exports = {};",
        "packages/config/src/index.js.json": { status: "notFound" },
        "packages/config/src/index.js/tsconfig.json": { status: "notFound" },
        "packages/config/tsconfig.json":
          '{"compilerOptions":{"baseUrl":"../api","paths":{"@routes":["src/routes"]}}}',
        "tsconfig.json": "{}",
      });
      const graph = createWorkspacePackageGraph({
        packageManifests: [
          {
            packageJson: { name: "@repo/config", ...packageEntry },
            relativeDirPath: "packages/config",
          },
        ],
        pnpmWorkspaceYaml: undefined,
        rootPackageJson: { workspaces: ["packages/*"] },
        sourceFilePaths: ["packages/config/src/index.js"],
      });

      const result = await readAliases(gateway, () => true, ["packages/api"], graph);

      expect(result.status).toBe("current");
      if (result.status !== "current") return;
      expect(result.importPathResolver?.("ownAlias", IMPORTER)).toEqual(["packages/api/src/own"]);
      expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
      expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
        ROOT,
        "packages/config/tsconfig.json",
        256 * 1024,
      );
      if (entryKind === "main") {
        expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
          ROOT,
          "packages/config/src/index.js",
          256 * 1024,
        );
      }
      if (entryKind === "exports") {
        expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
          ROOT,
          "packages/config/index.js",
          256 * 1024,
        );
      }
    },
  );

  it("falls through an unknown bare workspace package to node_modules and fails closed", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"unknown-config"}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT,
      "packages/api/node_modules/unknown-config.json",
      256 * 1024,
    );
  });

  it("continues from an unreadable extensionless candidate to its directory tsconfig", async () => {
    const gateway = configGateway({
      "packages/api/tsconfig.json": '{"extends":"@repo/tsconfig/base"}',
      "packages/tsconfig/base": () => {
        throw new Error("Is a directory");
      },
      "packages/tsconfig/base.json": { status: "notFound" },
      "packages/tsconfig/base/tsconfig.json":
        '{"compilerOptions":{"baseUrl":"../../api","paths":{"@routes":["src/routes"]}}}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway, () => true, ["packages/api"], workspaceGraph());

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(true);
  });

  it("resolves a registry package extends through the node_modules fallback", async () => {
    const gateway = configGateway({
      "node_modules/@tsconfig/node20/tsconfig.json":
        '{"compilerOptions":{"baseUrl":"../../../packages/api","paths":{"@routes":["src/routes"]}}}',
      "packages/api/tsconfig.json": '{"extends":"@tsconfig/node20/tsconfig.json"}',
      "packages/api/node_modules/@tsconfig/node20/tsconfig.json": { status: "notFound" },
      "packages/node_modules/@tsconfig/node20/tsconfig.json": { status: "notFound" },
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway, () => true, ["packages/api"], workspaceGraph());

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT,
      "node_modules/@tsconfig/node20/tsconfig.json",
      256 * 1024,
    );
  });

  it("reuses one workspace package config across one hundred packages", async () => {
    const packageDirectories = Array.from({ length: 100 }, (_, index) => `packages/p${index}`);
    const configs: ConfigResponses = {
      "packages/tsconfig/base.json":
        '{"compilerOptions":{"baseUrl":"..","paths":{"@routes":["shared/routes"]}}}',
      "tsconfig.json": "{}",
    };
    for (const directory of packageDirectories) {
      configs[`${directory}/tsconfig.json`] = '{"extends":"@repo/tsconfig/base.json"}';
    }
    const gateway = configGateway(configs);

    const result = await readAliases(gateway, () => true, packageDirectories, workspaceGraph());

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    for (const directory of packageDirectories) {
      expect(
        result.importPathResolver?.("@routes", {
          relativeFilePath: `${directory}/src/app.ts`,
        }),
      ).toEqual(["packages/shared/routes"]);
    }
    expect(result.truncated).toBe(false);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledTimes(102);
    expect(
      vi
        .mocked(gateway.readSourceTextBounded)
        .mock.calls.filter(([, relativePath]) => relativePath === "packages/tsconfig/base.json"),
    ).toHaveLength(1);
  });

  it("resolves a chain mixing relative and package-name extends links", async () => {
    const gateway = configGateway({
      "configs/tsconfig.mid.json": '{"extends":"@repo/tsconfig/base.json"}',
      "node_modules/@repo/tsconfig/base.json":
        '{"compilerOptions":{"baseUrl":"../../../packages/api","paths":{"@routes":["src/routes"]}}}',
      "configs/node_modules/@repo/tsconfig/base.json": { status: "notFound" },
      "packages/api/tsconfig.json": '{"extends":"../../configs/tsconfig.mid.json"}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
  });

  it.each([
    ["exports", '{"exports":{".":"./configs/base"}}'],
    ["tsconfig", '{"tsconfig":"configs/base"}'],
  ])("honors a package %s entry and extension fallback", async (_entry, packageJson) => {
    const gateway = configGateway({
      "node_modules/tsconfig-base/package.json": packageJson,
      "node_modules/tsconfig-base/configs/base": { status: "notFound" },
      "node_modules/tsconfig-base/configs/base.json":
        '{"compilerOptions":{"baseUrl":"../../../packages/api","paths":{"@routes":["src/routes"]}}}',
      "node_modules/tsconfig-base.json": { status: "notFound" },
      "packages/api/tsconfig.json": '{"extends":"tsconfig-base"}',
      "packages/api/node_modules/tsconfig-base.json": { status: "notFound" },
      "packages/api/node_modules/tsconfig-base/tsconfig.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base/package.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base/tsconfig.json": { status: "notFound" },
      "packages/api/node_modules/tsconfig-base/package.json": { status: "notFound" },
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT,
      "node_modules/tsconfig-base/configs/base.json",
      256 * 1024,
    );
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
  });

  it("falls back to a package tsconfig.json", async () => {
    const gateway = configGateway({
      "node_modules/tsconfig-base.json": { status: "notFound" },
      "node_modules/tsconfig-base/package.json": { status: "notFound" },
      "node_modules/tsconfig-base/tsconfig.json":
        '{"compilerOptions":{"baseUrl":"../../packages/api","paths":{"@routes":["src/routes"]}}}',
      "packages/api/tsconfig.json": '{"extends":"tsconfig-base"}',
      "packages/api/node_modules/tsconfig-base.json": { status: "notFound" },
      "packages/api/node_modules/tsconfig-base/package.json": { status: "notFound" },
      "packages/api/node_modules/tsconfig-base/tsconfig.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base/package.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base/tsconfig.json": { status: "notFound" },
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual(["packages/api/src/routes"]);
    expect(result.truncated).toBe(false);
  });

  it("falls back from a node_modules JavaScript export to tsconfig and preserves own paths", async () => {
    const gateway = configGateway({
      "packages/api/node_modules/shared-config.json": { status: "notFound" },
      "packages/api/node_modules/shared-config/dist/index.js": "module.exports = {};",
      "packages/api/node_modules/shared-config/dist/index.js.json": { status: "notFound" },
      "packages/api/node_modules/shared-config/dist/index.js/tsconfig.json": {
        status: "notFound",
      },
      "packages/api/node_modules/shared-config/package.json":
        '{"exports":"./dist/index.js"}',
      "packages/api/node_modules/shared-config/tsconfig.json":
        '{"compilerOptions":{"baseUrl":"../../../api","paths":{"@shared":["src/shared"]}}}',
      "packages/api/tsconfig.json":
        '{"extends":"shared-config","compilerOptions":{"paths":{"@app/routes":["src/routes"]}}}',
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@app/routes", IMPORTER)).toEqual([
      "packages/api/src/routes",
    ]);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT,
      "packages/api/node_modules/shared-config/tsconfig.json",
      256 * 1024,
    );
  });

  it("caps ancestor node_modules probing before reaching an unbounded root candidate", async () => {
    const segments = Array.from({ length: 70 }, (_, index) => `level-${index}`);
    const packageDirectory = segments.join("/");
    const configs: ConfigResponses = {
      [`${packageDirectory}/tsconfig.json`]: '{"extends":"@repo/tsconfig/base.json"}',
      "node_modules/@repo/tsconfig/base.json":
        '{"compilerOptions":{"paths":{"@routes":["packages/api/src/routes"]}}}',
      "tsconfig.json": "{}",
    };
    for (let index = segments.length; index > segments.length - 64; index -= 1) {
      const directory = segments.slice(0, index).join("/");
      configs[`${directory}/node_modules/@repo/tsconfig/base.json`] = { status: "notFound" };
    }
    const gateway = configGateway(configs);

    const result = await readAliases(gateway, () => true, [packageDirectory]);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(
      result.importPathResolver?.("@routes", {
        relativeFilePath: `${packageDirectory}/src/app.ts`,
      }),
    ).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT,
      "node_modules/@repo/tsconfig/base.json",
      256 * 1024,
    );
    expect(vi.mocked(gateway.readSourceTextBounded).mock.calls.length).toBeLessThanOrEqual(66);
  });

  it("detects cycles that cross package-name extends links", async () => {
    const gateway = configGateway({
      "node_modules/@repo/tsconfig/base.json": '{"extends":"../../../packages/api/tsconfig.json"}',
      "packages/api/tsconfig.json": '{"extends":"@repo/tsconfig/base.json"}',
      "packages/node_modules/@repo/tsconfig/base.json": { status: "notFound" },
      "packages/api/node_modules/@repo/tsconfig/base.json": { status: "notFound" },
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("fails closed when a package metadata entry escapes the workspace", async () => {
    const gateway = configGateway({
      "node_modules/tsconfig-base/package.json": '{"tsconfig":"../../../outside/base.json"}',
      "node_modules/tsconfig-base.json": { status: "notFound" },
      "packages/api/tsconfig.json": '{"extends":"tsconfig-base"}',
      "packages/api/node_modules/tsconfig-base.json": { status: "notFound" },
      "packages/api/node_modules/tsconfig-base/tsconfig.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base/package.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base.json": { status: "notFound" },
      "packages/node_modules/tsconfig-base/tsconfig.json": { status: "notFound" },
      "packages/api/node_modules/tsconfig-base/package.json": { status: "notFound" },
      "tsconfig.json": "{}",
    });

    const result = await readAliases(gateway);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.importPathResolver?.("@routes", IMPORTER)).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT,
      "outside/base.json",
      256 * 1024,
    );
  });

  it.each([
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

  it("keeps hostile package probing within the aggregate byte budget", async () => {
    const packageDirectories = Array.from({ length: 20 }, (_, index) => `packages/p${index}`);
    const hostileSource = "x".repeat(250_000);
    let bytesRead = 0;
    const gateway: WorkspaceSourceDiscoveryGateway = {
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: [],
        truncated: false,
        visited: 0,
      })),
      readSourceTextBounded: vi.fn(async (_root, relativePath, maxBytes) => {
        let content: string | undefined;
        if (relativePath === "tsconfig.json") content = "{}";
        if (/^packages\/p\d+\/tsconfig\.json$/u.test(relativePath)) {
          const packageName = relativePath.split("/")[1];
          content = `{"extends":"hostile-${packageName}"}`;
        }
        if (/\/node_modules\/hostile-p\d+\/package\.json$/u.test(relativePath)) {
          content = '{"exports":"./dist/index.js"}';
        }
        if (/\/node_modules\/hostile-p\d+\/dist\/index\.js$/u.test(relativePath)) {
          content = hostileSource;
        }
        if (/\/node_modules\/hostile-p\d+\/tsconfig\.json$/u.test(relativePath)) {
          content = "{}";
        }
        if (content === undefined) return { status: "notFound" as const };
        const contentBytes = new TextEncoder().encode(content).byteLength;
        bytesRead += Math.min(contentBytes, maxBytes);
        if (contentBytes > maxBytes) return { status: "tooLarge" as const };
        return { content, status: "ok" as const };
      }),
    };

    const result = await readAliases(gateway, () => true, packageDirectories);

    expect(result.status).toBe("current");
    if (result.status !== "current") return;
    expect(result.truncated).toBe(true);
    expect(bytesRead).toBeLessThanOrEqual(4 * 1024 * 1024);
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
  workspacePackageGraph = createWorkspacePackageGraph({
    packageManifests: [],
    pnpmWorkspaceYaml: undefined,
    rootPackageJson: {},
    sourceFilePaths: [],
  }),
) {
  return readExpressRouteTsconfigAliases({
    allowUnscopedRoot: true,
    gateway,
    incompleteDirectories: [],
    isCurrent,
    packageDirectories,
    rootPath: ROOT,
    workspacePackageGraph,
  });
}

function workspaceGraph() {
  return createWorkspacePackageGraph({
    packageManifests: [
      {
        packageJson: { name: "@repo/tsconfig" },
        relativeDirPath: "packages/tsconfig",
      },
    ],
    pnpmWorkspaceYaml: undefined,
    rootPackageJson: { workspaces: ["packages/*"] },
    sourceFilePaths: [],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
