import { describe, expect, it } from "vitest";
import { resolveExpressRouteMountsBounded } from "./expressRouteMounts";
import { createTsPathAliasResolver } from "./tsPathAliasResolver";

describe("resolveExpressRouteMountsBounded", () => {
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

  it("does not treat a commented import from-clause as module authority", () => {
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
    ).toEqual(["/evil", "/real"]);
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

    expect(result.routes.map((route) => route.path)).toEqual(["/api/users"]);
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
});
