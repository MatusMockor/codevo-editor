import { describe, expect, it } from "vitest";
import { resolveExpressRouteMountsBounded } from "./expressRouteMounts";
import { createTsPathAliasResolver } from "./tsPathAliasResolver";

describe("resolveExpressRouteMountsBounded", () => {
  it("distinguishes malformed-source uncertainty from actual capacity truncation", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "express-app.js",
          source:
            'const express=require("express"); const app=express(); app.get("/health", handler);',
        },
        {
          relativeFilePath: "unrelated-server.js",
          source: 'const http = require("http");\n}',
        },
      ],
      100,
    );

    expect(result.routes).toEqual([expect.objectContaining({ method: "GET", path: "/health" })]);
    expect(result.truncated).toBe(true);
    expect(result.capacityTruncated).toBe(false);
  });

  it("resolves a router mounted without an explicit prefix", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/server.ts",
          source: [
            "import express from 'express';",
            "const app = express();",
            "const router = express.Router();",
            "const health = express.Router();",
            "app.use(router);",
            "router.use('/v1', health);",
            "health.get('/health', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toContainEqual(
      expect.objectContaining({
        method: "GET",
        path: "/v1/health",
        receiver: "health",
      }),
    );
  });

  it("resolves every provable router after prefixed middleware in declaration order", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/server.ts",
          source: [
            "import express from 'express';",
            "const app = express();",
            "const users = express.Router();",
            "const admins = express.Router();",
            "app.use('/api', auth, users, admins);",
            "users.get('/users', listUsers);",
            "admins.get('/admins', listAdmins);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.filter(({ method }) => method === "GET").map(({ path }) => path)).toEqual([
      "/api/users",
      "/api/admins",
    ]);
  });

  it("fails closed when a no-prefix mount could instead contain a dynamic path", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/server.ts",
          source: [
            "import express from 'express';",
            "const app = express();",
            "const router = express.Router();",
            "app.use(dynamicPrefix, router);",
            "router.get('/users', listUsers);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.find(({ method }) => method === "GET")?.path).toBe("/users");
  });

  it("fails the entire mount closed when any prefixed handler expression is ambiguous", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/server.ts",
          source: [
            "import express from 'express';",
            "const app = express();",
            "const router = express.Router();",
            "app.use('/api', auth(), router);",
            "router.get('/users', listUsers);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.find(({ method }) => method === "GET")?.path).toBe("/users");
  });

  it("bounds adversarial mount target lists and reports fail-closed truncation", () => {
    const handlers = Array.from({ length: 20_001 }, (_, index) => `middleware${index}`);
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/server.ts",
          source: [
            "import express from 'express';",
            "const app = express();",
            "const router = express.Router();",
            `app.use('/api', ${handlers.join(", ")}, router);`,
            "router.get('/users', listUsers);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.truncated).toBe(true);
    expect(result.capacityTruncated).toBe(true);
    expect(result.routes.find(({ method }) => method === "GET")?.path).toBe("/users");
  });

  it("resolves an aliased router import to its mount prefix", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import router from '@/routes/api';",
            "const app = express();",
            "app.use('/api', router);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/routes/api.ts",
          source: [
            "import express from 'express';",
            "const router = express.Router();",
            "router.get('/users', listUsers);",
            "export default router;",
          ].join("\n"),
        },
      ],
      100,
      (specifier) => (specifier === "@/routes/api" ? ["src/routes/api"] : []),
    );

    expect(result.routes).toContainEqual(
      expect.objectContaining({
        method: "GET",
        path: "/api/users",
        relativeFilePath: "src/routes/api.ts",
      }),
    );
  });

  it("resolves a wildcard alias through the existing extension candidates", () => {
    const { resolve: resolveAlias } = createTsPathAliasResolver({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
        },
      },
    });
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import router from '@/routes/api';",
            "const app = express();",
            "app.use('/api', router);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/routes/api/index.ts",
          source: [
            "import express from 'express';",
            "const router = express.Router();",
            "router.get('/status', handler);",
            "export default router;",
          ].join("\n"),
        },
      ],
      100,
      resolveAlias,
    );

    expect(result.routes).toContainEqual(
      expect.objectContaining({
        method: "GET",
        path: "/api/status",
        relativeFilePath: "src/routes/api/index.ts",
      }),
    );
  });

  it("passes exact importer authority to isolate identical aliases in sibling packages", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          packageLabel: "api",
          relativeFilePath: "packages/api/src/app.ts",
          source: [
            "import express from 'express';",
            "import router from '@routes';",
            "const app = express();",
            "app.use('/api', router);",
          ].join("\n"),
        },
        {
          packageLabel: "api",
          relativeFilePath: "packages/api/src/routes.ts",
          source: [
            "import express from 'express';",
            "const router = express.Router();",
            "router.get('/users', handler);",
            "export default router;",
          ].join("\n"),
        },
        {
          packageLabel: "admin",
          relativeFilePath: "packages/admin/src/app.ts",
          source: [
            "import express from 'express';",
            "import router from '@routes';",
            "const app = express();",
            "app.use('/admin', router);",
          ].join("\n"),
        },
        {
          packageLabel: "admin",
          relativeFilePath: "packages/admin/src/routes.ts",
          source: [
            "import express from 'express';",
            "const router = express.Router();",
            "router.get('/users', handler);",
            "export default router;",
          ].join("\n"),
        },
      ],
      100,
      (specifier, importer) => {
        if (specifier !== "@routes") return [];
        if (importer.relativeFilePath.startsWith("packages/api/")) {
          return ["packages/api/src/routes"];
        }
        if (importer.relativeFilePath.startsWith("packages/admin/")) {
          return ["packages/admin/src/routes"];
        }
        return [];
      },
    );

    expect(
      result.routes
        .filter(({ method }) => method === "GET")
        .map(({ packageLabel, path, relativeFilePath }) => ({
          packageLabel,
          path,
          relativeFilePath,
        })),
    ).toEqual([
      {
        packageLabel: "api",
        path: "/api/users",
        relativeFilePath: "packages/api/src/routes.ts",
      },
      {
        packageLabel: "admin",
        path: "/admin/users",
        relativeFilePath: "packages/admin/src/routes.ts",
      },
    ]);
  });

  it("resolves an importer-scoped alias to a router in a sibling package", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          packageLabel: "api",
          relativeFilePath: "packages/api/src/app.ts",
          source: [
            "import express from 'express';",
            "import router from '@shared/router';",
            "const app = express();",
            "app.use('/api', router);",
          ].join("\n"),
        },
        {
          packageLabel: "shared",
          relativeFilePath: "packages/shared/src/router.ts",
          source: [
            "import express from 'express';",
            "const router = express.Router();",
            "router.get('/shared', handler);",
            "export default router;",
          ].join("\n"),
        },
      ],
      100,
      (specifier, importer) =>
        specifier === "@shared/router" && importer.packageLabel === "api"
          ? ["packages/shared/src/router"]
          : [],
    );

    expect(result.routes).toContainEqual(
      expect.objectContaining({
        method: "GET",
        packageLabel: "shared",
        path: "/api/shared",
        relativeFilePath: "packages/shared/src/router.ts",
      }),
    );
  });

  it("leaves an unresolved aliased router without a mount edge", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import router from '@/routes/api';",
            "const app = express();",
            "app.use('/api', router);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/routes/api.ts",
          source: [
            "import express from 'express';",
            "const router = express.Router();",
            "router.get('/status', handler);",
            "export default router;",
          ].join("\n"),
        },
      ],
      100,
      () => [],
    );

    expect(
      result.routes.find(
        (route) => route.method === "GET" && route.relativeFilePath === "src/routes/api.ts",
      )?.path,
    ).toBe("/status");
  });

  it("resolves a default-imported router through a literal app mount", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/server.ts",
          source: [
            "import createExpress from 'express';",
            "import users from './routes/users';",
            "const api = createExpress();",
            "api.use('/api/v1', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/routes/users.ts",
          source: [
            "import express from 'express';",
            "const usersRouter = express.Router();",
            "usersRouter.get('/users', listUsers);",
            "export default usersRouter;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result).toMatchObject({ truncated: false });
    expect(
      result.routes.map(({ method, path, receiver, relativeFilePath }) => ({
        method,
        path,
        receiver,
        relativeFilePath,
      })),
    ).toContainEqual({
      method: "GET",
      path: "/api/v1/users",
      receiver: "usersRouter",
      relativeFilePath: "src/routes/users.ts",
    });
  });

  it("resolves named imports and nested router mounts to every exact runtime path", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/index.ts",
          source: [
            "import express from 'express';",
            "import { apiRouter as api } from './api/index';",
            "const web = express();",
            "web.use('/one', api);",
            "web.use('/two', api);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/api/index.ts",
          source: [
            "import { Router as makeRouter } from 'express';",
            "import accounts from './accounts.js';",
            "const apiRouter = makeRouter();",
            "apiRouter.use('/v2', accounts);",
            "export { apiRouter };",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/api/accounts.ts",
          source: [
            "const express = require('express');",
            "const accountRoutes = express.Router();",
            "accountRoutes.patch('/accounts/:id', update);",
            "module.exports = accountRoutes;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "PATCH").map((route) => route.path),
    ).toEqual(["/one/v2/accounts/:id", "/two/v2/accounts/:id"]);
  });

  it("resolves explicit extensions and CommonJS require/export aliases", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.cjs",
          source: [
            "const express = require('express');",
            "const { users: mountedUsers } = require('./users.cjs');",
            "const app = express();",
            "app.use('/api', mountedUsers);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.cjs",
          source: [
            "const internalUsers = require('express').Router();",
            "internalUsers.get('/users', listUsers);",
            "exports.users = internalUsers;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/api/users",
          receiver: "internalUsers",
          relativeFilePath: "src/users.cjs",
        }),
      ]),
    );
  });

  it("follows router aliases re-exported through an intermediate module", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import { publicUsers } from './routes';",
            "const app = express();",
            "app.use('/api', publicUsers);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/routes.ts",
          source: ["import users from './users';", "export { users as publicUsers };"].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', listUsers);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "GET", path: "/api/users" })]),
    );
  });

  it("resolves direct named and star barrel exports without executing modules", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import { publicUsers } from './routes';",
            "const app = express();",
            "app.use('/api', publicUsers);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/routes.ts",
          source: "export * from './public-routes';",
        },
        {
          relativeFilePath: "src/public-routes.ts",
          source: "export { default as publicUsers } from './users';",
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', listUsers);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "GET", path: "/api/users" })]),
    );
  });

  it("folds bounded const, concatenated, and template-literal mount prefixes", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const ROOT = '/api';",
            "const VERSION = 'v1';",
            "const PREFIX = `${ROOT}/${VERSION}`;",
            "const app = express();",
            "app.use(PREFIX + '/public', users);",
            "app.use(`${ROOT}/internal`, users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', listUsers);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/api/internal/users", "/api/v1/public/users"]);
  });

  it("keeps identical relative module paths isolated by package", () => {
    const packageFiles = (packageLabel: string, prefix: string, routePath: string) => [
      {
        packageLabel,
        relativeFilePath: "src/app.ts",
        source: [
          "import express from 'express';",
          "import users from './users';",
          "const app = express();",
          `app.use('${prefix}', users);`,
        ].join("\n"),
      },
      {
        packageLabel,
        relativeFilePath: "src/users.ts",
        source: [
          "import express from 'express';",
          "const users = express.Router();",
          `users.get('${routePath}', handler);`,
          "export default users;",
        ].join("\n"),
      },
    ];
    const result = resolveExpressRouteMountsBounded(
      [...packageFiles("api-a", "/a", "/users-a"), ...packageFiles("api-b", "/b", "/users-b")],
      100,
    );

    expect(
      result.routes
        .filter((route) => route.method === "GET")
        .map(({ packageLabel, path }) => ({ packageLabel, path })),
    ).toEqual([
      { packageLabel: "api-a", path: "/a/users-a" },
      { packageLabel: "api-b", path: "/b/users-b" },
    ]);
  });

  it("fails closed for ambiguous/cyclic barrels and dynamic constant expressions", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import { users } from './ambiguous';",
            "import { loop } from './cycle-a';",
            "import dynamicUsers from './dynamic-users';",
            "const app = express();",
            "const dynamic = getPrefix();",
            "app.use(dynamic, dynamicUsers);",
            "app.use('/loop', loop);",
            "app.use('/ambiguous', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/ambiguous.ts",
          source: "export * from './a'; export * from './b';",
        },
        {
          relativeFilePath: "src/a.ts",
          source: [
            "const users = require('express').Router();",
            "users.get('/from-a', handler);",
            "export { users };",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/b.ts",
          source: [
            "const users = require('express').Router();",
            "users.get('/from-b', handler);",
            "export { users };",
          ].join("\n"),
        },
        { relativeFilePath: "src/cycle-a.ts", source: "export * from './cycle-b';" },
        { relativeFilePath: "src/cycle-b.ts", source: "export * from './cycle-a';" },
        {
          relativeFilePath: "src/dynamic-users.ts",
          source: [
            "const dynamicUsers = require('express').Router();",
            "dynamicUsers.get('/dynamic', handler);",
            "export default dynamicUsers;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/from-a", "/from-b", "/dynamic"]);
    expect(
      result.routes.some(
        (route) => route.path.startsWith("/ambiguous/") || route.path.startsWith("/loop/"),
      ),
    ).toBe(false);
  });

  it("does not mount duplicate package/module identities", () => {
    const routerSource = (routePath: string) =>
      [
        "const users = require('express').Router();",
        `users.get('${routePath}', handler);`,
        "export default users;",
      ].join("\n");
    const result = resolveExpressRouteMountsBounded(
      [
        {
          packageLabel: "api",
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          packageLabel: "api",
          relativeFilePath: "src/users.ts",
          source: routerSource("/first"),
        },
        {
          packageLabel: "api",
          relativeFilePath: "src/users.ts",
          source: routerSource("/second"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/first", "/second"]);
    expect(result.routes.some((route) => route.path.startsWith("/api/"))).toBe(false);
  });

  it("bounds long barrel chains and reports truncated static resolution", () => {
    const snapshots = [
      {
        relativeFilePath: "src/app.ts",
        source: [
          "import express from 'express';",
          "import users from './barrel-0';",
          "const app = express();",
          "app.use('/api', users);",
        ].join("\n"),
      },
    ];
    for (let index = 0; index < 80; index += 1) {
      snapshots.push({
        relativeFilePath: `src/barrel-${index}.ts`,
        source: `export { default } from './barrel-${index + 1}';`,
      });
    }
    snapshots.push({
      relativeFilePath: "src/barrel-80.ts",
      source: [
        "const users = require('express').Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    });

    const result = resolveExpressRouteMountsBounded(snapshots, 100);

    expect(result.truncated).toBe(true);
    expect(result.routes.find((route) => route.method === "GET")?.path).toBe("/users");
  });

  it("bounds prefix expansion in a heavily branching mount graph", () => {
    const declarations = ["import express from 'express';", "const app = express();"];
    for (let index = 0; index < 30; index += 1) {
      declarations.push(`const router${index} = express.Router();`);
    }
    declarations.push("router29.get('/leaf', handler);");
    declarations.push("app.use('/root-a', router0);", "app.use('/root-b', router0);");
    for (let index = 0; index < 29; index += 1) {
      declarations.push(
        `router${index}.use('/a', router${index + 1});`,
        `router${index}.use('/b', router${index + 1});`,
      );
    }
    const result = resolveExpressRouteMountsBounded(
      [{ relativeFilePath: "src/server.ts", source: declarations.join("\n") }],
      10,
    );

    expect(result.routes).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("does not derive paths for dynamic, ambiguous, unresolved, or cyclic mounts", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import missing from './missing';",
            "import duplicate from './duplicate';",
            "const app = express();",
            "app.use(prefix, missing);",
            "app.use('/duplicate', duplicate);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/duplicate.ts",
          source: "const router = require('express').Router(); export default router;",
        },
        {
          relativeFilePath: "src/duplicate.js",
          source: "const router = require('express').Router(); export default router;",
        },
        {
          relativeFilePath: "src/local.ts",
          source: [
            "import express from 'express';",
            "const first = express.Router();",
            "const second = express.Router();",
            "first.use('/a', second);",
            "second.use('/b', first);",
            "first.get('/local', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.some((route) => route.path === "/duplicate/local")).toBe(false);
    expect(result.routes.find((route) => route.method === "GET")?.path).toBe("/local");
  });

  it("stops derived expansion at the caller route budget", () => {
    const source = [
      "import express from 'express';",
      "const app = express();",
      "const router = express.Router();",
      "app.use('/a', router);",
      "app.use('/b', router);",
      "router.get('/one', one);",
      "router.post('/two', two);",
    ].join("\n");

    const result = resolveExpressRouteMountsBounded(
      [{ relativeFilePath: "src/server.ts", source }],
      3,
    );

    expect(result.routes).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("ignores route and mount lookalikes in comments and strings", () => {
    const source = [
      "import express from 'express';",
      "const api = express();",
      "const users = express.Router();",
      "// api.use('/ghost', users);",
      "const example = \"api.use('/string', users)\";",
      "users.get('/real', handler);",
    ].join("\n");

    const result = resolveExpressRouteMountsBounded(
      [{ relativeFilePath: "src/server.ts", source }],
      100,
    );

    expect(result.routes.find((route) => route.method === "GET")?.path).toBe("/real");
  });

  it("does not treat a commented from-clause as specifier authority", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users /* from './evil' */ from './real';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/evil.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/evil', handler);",
            "export default users;",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/real.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/real', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/evil", "/api/real"]);
  });

  it("keeps conventional app/router names non-authoritative for mount resolution", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/custom.ts",
          source: [
            "const app = customApplication();",
            "const router = customRouter();",
            "app.use('/not-express', router);",
            "router.get('/local', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/local"]);
    expect(result.routes.some((route) => route.path === "/not-express/local")).toBe(false);
  });

  it("does not trust a local function merely because it is named express", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/custom.ts",
          source: [
            "function express() { return customApplication(); }",
            "const app = express();",
            "const router = customRouter();",
            "app.use('/not-express', router);",
            "router.get('/local', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/local"]);
    expect(result.routes.some((route) => route.path === "/not-express/local")).toBe(false);
  });

  it("does not let a nested parameter shadow an authoritative app receiver", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "function configure(app) { app.use('/fake', users); }",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/u', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/u"]);
    expect(result.routes.some((route) => route.path === "/fake/u")).toBe(false);
  });

  it("does not let a nested parameter shadow an authoritative Express factory", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "app.use('/real', users);",
            "function configure(express) {",
            "  const local = express();",
            "  local.use('/fake', users);",
            "}",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/u', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/real/u"]);
    expect(result.routes.some((route) => route.path === "/fake/u")).toBe(false);
  });

  it("does not resolve mount constants across lexical scopes", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "function hidden() { const PREFIX = '/hidden'; }",
            "app.use(PREFIX, users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.map((route) => route.path)).toEqual(["/users"]);
  });

  it("does not let a nested CommonJS Express require authorize a top-level receiver", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import users from './users';",
            "function neverCalled() { const express = require('express'); }",
            "const api = express();",
            "api.use('/ghost', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/users"]);
    expect(result.routes.some((route) => route.path === "/ghost/users")).toBe(false);
  });

  it("does not let a nested CommonJS local require authorize a derived mount", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "function neverCalled() { const users = require('./users'); }",
            "const app = express();",
            "app.use('/ghost', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/users"]);
    expect(result.routes.some((route) => route.path === "/ghost/users")).toBe(false);
  });

  it("does not let a nested CommonJS export authorize a derived mount", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "app.use('/ghost', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "function neverCalled() { module.exports = users; }",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/users"]);
    expect(result.routes.some((route) => route.path === "/ghost/users")).toBe(false);
  });

  it.each([
    ["if body", "if (false) module.exports = users;"],
    ["while body", "while (false) module.exports = users;"],
    ["label body", "neverRun: module.exports = users;"],
    ["logical expression", "false && (module.exports = users);"],
    ["multiline logical expression", "false &&\nmodule.exports = users;"],
    ["arrow body", "(() => module.exports = users);"],
    ["ternary expression", "false ? module.exports = users : null;"],
    ["comma expression", "(void 0, module.exports = users);"],
    ["parenthesized expression", "(module.exports = users);"],
  ])(
    "does not let a CommonJS export in an unconditional-looking %s authorize a mount",
    (_label, conditionalExport) => {
      const result = resolveExpressRouteMountsBounded(
        [
          {
            relativeFilePath: "src/app.cjs",
            source: [
              "const express = require('express');",
              "const users = require('./users');",
              "const app = express();",
              "app.use('/ghost', users);",
            ].join("\n"),
          },
          {
            relativeFilePath: "src/users.cjs",
            source: [
              "const express = require('express');",
              "const users = express.Router();",
              "users.get('/users', handler);",
              conditionalExport,
            ].join("\n"),
          },
        ],
        100,
      );

      expect(
        result.routes.filter((route) => route.method === "GET").map((route) => route.path),
      ).toEqual(["/users"]);
      expect(result.routes.some((route) => route.path === "/ghost/users")).toBe(false);
    },
  );

  it("rejects conditional CommonJS imports, receiver declarations, and mounts without hiding raw routes", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.cjs",
          source: [
            "const express = require('express');",
            "if (false) var users = require('./users');",
            "if (false) var conditionalApp = express();",
            "while (false) conditionalApp.use('/receiver-ghost', users);",
            "const app = express();",
            "if (false) app.use('/mount-ghost', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.cjs",
          source: [
            "const express = require('express');",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "module.exports = users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/users"]);
    expect(
      result.routes.some((route) => route.method === "USE" && route.path === "/mount-ghost"),
    ).toBe(true);
    expect(result.routes.some((route) => route.path === "/mount-ghost/users")).toBe(false);
    expect(result.routes.some((route) => route.path === "/receiver-ghost/users")).toBe(false);
  });

  it("does not treat a for-init lexical declaration as a module mount constant", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "for (const PREFIX = '/ghost'; false;) {}",
            "app.use(PREFIX, users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.map((route) => route.path)).toEqual(["/users"]);
  });

  it("does not derive a mount from a top-level for-await single-statement body", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.mts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "for await (const ignored of []) app.use('/ghost', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/users"]);
    expect(result.routes.some((route) => route.path === "/ghost/users")).toBe(false);
  });

  it("fails derived authority closed when module delimiter structure is malformed", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "app.use('/ghost', users);",
            "const malformed = (",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/users"]);
    expect(result.routes.some((route) => route.path === "/ghost/users")).toBe(false);
  });

  it("fails malformed square-bracket authority closed and reports truncation", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "const malformed = [",
            "0;",
            "app.use('/ghost', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.some((route) => route.path === "/ghost/users")).toBe(false);
    expect(result.routes.some((route) => route.path === "/users")).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("keeps valid nested arrays and computed access from masking later direct mounts", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "const nested = [[app['use']], [{ value: users }]];",
            "app['use']('/computed', users);",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.some((route) => route.path === "/computed/users")).toBe(false);
    expect(result.routes.some((route) => route.path === "/api/users")).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("keeps unconditional semicolonless static mounts authoritative", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express'",
            "import users from './users'",
            "const app = express()",
            "const PREFIX = '/api'",
            "app.use(PREFIX, users)",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express'",
            "const users = express.Router()",
            "users.get('/users', handler)",
            "export default users",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/api/users"]);
    expect(result.truncated).toBe(false);
  });

  it("reports truncation instead of silently dropping a relevant re-export behind the shared binding budget", () => {
    const irrelevantReExports = Array.from(
      { length: 20_000 },
      (_, index) => `export { missing as unused${index} } from './missing-${index}';`,
    ).join("\n");
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import { users } from './barrel';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/barrel.ts",
          source: `${irrelevantReExports}\nexport { users } from './users';`,
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export { users };",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.some((route) => route.path === "/api/users")).toBe(false);
    expect(result.routes.some((route) => route.path === "/users")).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("fails closed for unsupported cooked template escapes", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "app.use(`\\x2fapi`, users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.map((route) => route.path)).toEqual(["/users"]);
  });

  it("lets a direct re-export shadow conflicting star exports", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import { users } from './barrel';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/barrel.ts",
          source: "export { users } from './direct'; export * from './conflict';",
        },
        {
          relativeFilePath: "src/direct.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/direct', handler);",
            "export { users };",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/conflict.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/conflict', handler);",
            "export { users };",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/api/direct", "/conflict"]);
  });

  it("resolves multiline commented imports and typed exported router declarations", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import {",
            "  users /* stable binding */,",
            "} from './users';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import {",
            "  Router as ExpressRouter,",
            "} from 'express';",
            "export const users: ReturnType<typeof ExpressRouter> = ExpressRouter();",
            "users.get('/users', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/api/users"]);
    expect(result.truncated).toBe(false);
  });

  it("does not treat type-only multiline imports as runtime Express authority", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/not-express.ts",
          source: [
            "import type {",
            "  Router,",
            "} from 'express';",
            "const users: Router = Router();",
            "users.get('/ghost', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("ignores from text inside import comments and keeps the real mount specifier", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import { users /* from 'bogus' */ } from './users';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import { Router } from 'express';",
            "export const users: Router = Router();",
            "users.get('/users', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/api/users"]);
    expect(result.truncated).toBe(false);
  });

  it("does not grant runtime Router authority to a mixed type-only specifier", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/not-express.ts",
          source: [
            "import { type Router } from 'express';",
            "const users = Router();",
            "users.get('/ghost', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("accepts an import whose from keyword ends at the static clause boundary", () => {
    const boundaryComment = `/*${"x".repeat(4_081)}*/`;
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            `import users${boundaryComment} from './users';`,
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import { Router } from 'express';",
            "const users: Router = Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/api/users"]);
    expect(result.capacityTruncated).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("truthfully truncates an import clause beyond the static analysis boundary", () => {
    const padding = Array.from({ length: 700 }, (_, index) => `unused${index}`).join(", ");
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            `import { ${padding}, users } from './users';`,
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import { Router } from 'express';",
            "export const users = Router();",
            "users.get('/users', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.some((route) => route.path === "/api/users")).toBe(false);
    expect(result.routes.some((route) => route.path === "/users")).toBe(true);
    expect(result.capacityTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("bounds adversarial repeated import keywords without scanning overlapping clauses", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/adversarial.ts",
          source: `app.get('/hidden', handler);${"import ".repeat(300_000)}`,
        },
      ],
      100,
    );

    expect(result.capacityTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("fails closed before deeply parenthesized static prefixes exhaust the call stack", () => {
    const depth = 5_000;
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/deep-prefix.ts",
          source: [
            "import express from 'express';",
            "const app = express();",
            "const router = express.Router();",
            `const prefix = ${"(".repeat(depth)}'/api'${")".repeat(depth)};`,
            "app.use(prefix, router);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toEqual([]);
    expect(result.capacityTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("truthfully truncates static prefix expressions beyond the parser work budget", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/oversized-prefix.ts",
          source: [
            "import express from 'express';",
            "const app = express();",
            "const router = express.Router();",
            `const prefix = '${"x".repeat(20_000)}';`,
            "app.use(prefix, router);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toEqual([]);
    expect(result.capacityTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("classifies adversarial same-line declarations in linear time", () => {
    const source = Array.from(
      { length: 8_000 },
      (_, index) => `export const receiver${index}=express() `,
    ).join("");

    const startedAt = performance.now();
    const result = resolveExpressRouteMountsBounded(
      [{ relativeFilePath: "src/partial.ts", source }],
      100,
    );

    expect(result.routes).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("retains the bounded route prefix when a flat file exceeds the result limit", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/routes.ts",
          source: "app.get('', handler);\n".repeat(100_000),
        },
      ],
      20_000,
    );

    expect(result.routes).toHaveLength(20_000);
    expect(result.routes[19_999]).toMatchObject({ line: 20_000, method: "GET", path: "" });
    expect(result.capacityTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("does not let a dynamic import consume the following static import", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import('./lazy');",
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import { Router } from 'express';",
            "const users = Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/api/users"]);
    expect(result.truncated).toBe(false);
  });

  it("does not let import.meta consume the following static import", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "const here = import.meta.url;",
            "import express from 'express';",
            "import users from './users';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import { Router } from 'express';",
            "const users = Router();",
            "users.get('/users', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes.filter((route) => route.method === "GET").map((route) => route.path),
    ).toEqual(["/api/users"]);
    expect(result.truncated).toBe(false);
  });

  it.each([
    "const holder = { import: 1 };",
    "export { value as import };",
    "const { import: value } = holder;",
  ])("does not let an identifier named import consume a later static import: %s", (prefix) => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/routes.ts",
          source: [
            prefix,
            "import { Router } from 'express';",
            "const routes = Router();",
            "routes.get('/real', handler);",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes).toEqual([
      expect.objectContaining({ method: "GET", path: "/real", receiver: "routes" }),
    ]);
    expect(result.capacityTruncated).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("does not classify an import property access as a truncated static import", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/property.ts",
          source: `obj.import; app.get('/real', handler);${"x".repeat(4_097)}`,
        },
      ],
      100,
    );

    expect(result.routes.some((route) => route.path === "/real")).toBe(true);
    expect(result.capacityTruncated).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("truthfully truncates oversized trivia after an import from keyword", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: `import users from /*${"x".repeat(4_097)}*/ './users';`,
        },
      ],
      100,
    );

    expect(result.capacityTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("preserves target package identity for a relative cross-package mount", () => {
    const result = resolveExpressRouteMountsBounded(
      [
        {
          packageLabel: "api",
          relativeFilePath: "packages/api/src/app.ts",
          source: [
            "import express from 'express';",
            "import shared from '../../shared/src/router';",
            "const app = express();",
            "app.use('/api', shared);",
          ].join("\n"),
        },
        {
          packageLabel: "shared",
          relativeFilePath: "packages/shared/src/router.ts",
          source: [
            "import { Router } from 'express';",
            "const shared = Router();",
            "shared.get('/shared', handler);",
            "export default shared;",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(
      result.routes
        .filter((route) => route.method === "GET")
        .map(({ packageLabel, path }) => ({ packageLabel, path })),
    ).toEqual([{ packageLabel: "shared", path: "/api/shared" }]);
  });
});
