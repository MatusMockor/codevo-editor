import { describe, expect, it } from "vitest";
import {
  projectNetteWorkspaceRoutes,
  type NetteWorkspaceRoutesResult,
} from "./netteWorkspaceRoutes";

const ROOT = "/workspace";

function ok(result: NetteWorkspaceRoutesResult) {
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error(result.message);
  return result;
}

describe("projectNetteWorkspaceRoutes", () => {
  it("indexes static masks with string and array presenter targets", () => {
    const path = `${ROOT}/app/Router/RouterFactory.php`;
    const source = [
      "<?php",
      "$router[] = new Route('/product/<id>', 'Product:show');",
      "$router[] = new \\Nette\\Application\\Routers\\Route('/admin', [",
      "    'presenter' => 'Admin:Dashboard',",
      "    'action' => 'default',",
      "]);",
      "$router[] = new Route('/dynamic', $defaults);",
    ].join("\n");
    const result = ok(projectNetteWorkspaceRoutes(ROOT, [{ path, source }]));

    expect(result.routes).toEqual([
      {
        key: expect.any(String),
        mask: "/product/<id>",
        methods: [],
        target: { raw: "Product:show", presenter: "Product", action: "show" },
        source: { path, lineNumber: 2, column: 23 },
      },
      {
        key: expect.any(String),
        mask: "/admin",
        methods: [],
        target: {
          raw: "Admin:Dashboard:default",
          presenter: "Admin:Dashboard",
          action: "default",
        },
        source: { path, lineNumber: 3, column: 50 },
      },
      {
        key: expect.any(String),
        mask: "/dynamic",
        methods: [],
        target: null,
        source: { path, lineNumber: 7, column: 23 },
      },
    ]);
    expect(new Set(result.routes.map((route) => route.key)).size).toBe(3);
  });

  it("ignores dynamic masks and route-looking strings or comments", () => {
    const source = [
      "<?php",
      "// new Route('/comment', 'Bad:default');",
      "$text = \"new Route('/string', 'Bad:default')\";",
      "$router[] = new Route($mask, 'Dynamic:default');",
      "$router[] = new Route('/real', 'Real:default');",
    ].join("\n");
    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [
        {
          path: `${ROOT}/app/Router.php`,
          source,
        },
      ]),
    );

    expect(result.routes.map((route) => route.mask)).toEqual(["/real"]);
  });

  it("indexes confirmed RouteList addRoute calls in source order", () => {
    const path = `${ROOT}/app/Router/RouterFactory.php`;
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "$router = new RouteList;",
      "$router->addRoute('/first', 'Home:first');",
      "$router->addRoute('/second', [",
      "    'presenter' => 'Product',",
      "    'action' => 'show',",
      "]);",
      "$router[] = new Route('/legacy', 'Legacy:default');",
      "$router->addRoute('/last', ['presenter' => 'Last'], oneWay: true);",
    ].join("\n");

    const result = ok(projectNetteWorkspaceRoutes(ROOT, [{ path, source }]));

    expect(result.routes.map(({ mask }) => mask)).toEqual([
      "/first",
      "/second",
      "/legacy",
      "/last",
    ]);
    expect(result.routes[0]).toMatchObject({
      registration: "addRoute",
      oneWay: false,
      modulePrefix: null,
      target: { raw: "Home:first", presenter: "Home", action: "first" },
    });
    expect(result.routes[1]).toMatchObject({
      target: { raw: "Product:show", presenter: "Product", action: "show" },
    });
    expect(result.routes[2]).not.toHaveProperty("registration");
    expect(result.routes[3]).toMatchObject({
      oneWay: true,
      target: { raw: "Last:default", presenter: "Last", action: "default" },
    });
  });

  it("tracks FQCN and imported aliases with static module prefixes", () => {
    const path = `${ROOT}/app/Router/RouterFactory.php`;
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList as Routes;",
      "$root = new \\Nette\\Application\\Routers\\RouteList('Front');",
      "$root->addRoute('/home', 'Home:default', false);",
      "$admin = $root->withModule('Admin');",
      "$admin->addRoute('/users', ['presenter' => 'User', 'action' => 'list']);",
      "$aliased = new Routes('Api');",
      "$aliased->withModule('V1')->addRoute('/products', 'Product:show');",
      "$root->addRoute('/absolute', ':Shared:Ping:default');",
    ].join("\n");

    const result = ok(projectNetteWorkspaceRoutes(ROOT, [{ path, source }]));

    expect(
      result.routes.map((route) => [route.mask, route.target?.raw, route.modulePrefix]),
    ).toEqual([
      ["/home", "Front:Home:default", "Front"],
      ["/users", "Front:Admin:User:list", "Front:Admin"],
      ["/products", "Api:V1:Product:show", "Api:V1"],
      ["/absolute", ":Shared:Ping:default", "Front"],
    ]);
  });

  it("supports PHP-insensitive aliases, nested module chains, and trailing commas", () => {
    const path = `${ROOT}/app/Router/RouterFactory.php`;
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList as Routes;",
      "$router = new routes('Root',);",
      "$router->withModule('Admin',)->withModule('Api',)->addRoute(",
      "  '/nested',",
      "  ['presenter' => 'Product', 'action' => 'show',],",
      "  oneWay: true,",
      ");",
      "$fqcn = new \\NETTE\\APPLICATION\\ROUTERS\\ROUTELIST;",
      "$fqcn->addRoute('/fqcn', 'Home:default',);",
    ].join("\n");

    const result = ok(projectNetteWorkspaceRoutes(ROOT, [{ path, source }]));

    expect(result.routes).toEqual([
      expect.objectContaining({
        mask: "/nested",
        modulePrefix: "Root:Admin:Api",
        oneWay: true,
        target: expect.objectContaining({ raw: "Root:Admin:Api:Product:show" }),
      }),
      expect.objectContaining({
        mask: "/fqcn",
        oneWay: false,
        target: expect.objectContaining({ raw: "Home:default" }),
      }),
    ]);
  });

  it("fails closed for unrelated receivers, dynamic values, reassignment and branches", () => {
    const source = [
      "<?php",
      "class RouteList {}",
      "$unrelated = new RouteList;",
      "$unrelated->addRoute('/unrelated', 'Bad:default');",
      "use Nette\\Application\\Routers\\RouteList as NetteRoutes;",
      "$router = new NetteRoutes;",
      "$other->addRoute('/unknown', 'Bad:default');",
      "$router->addRoute($mask, 'Bad:default');",
      "$router->addRoute('/dynamic-target', $defaults);",
      "$router->addRoute('/dynamic-one-way', 'Bad:default', $oneWay);",
      "if ($enabled) { $router->addRoute('/branch', 'Bad:default'); }",
      "if ($enabled) $router->addRoute('/branch-no-braces', 'Bad:default');",
      "$router = makeRouter();",
      "$router->addRoute('/after-reassign', 'Bad:default');",
      "$confirmed = new NetteRoutes;",
      "$confirmed->addRoute('/real', 'Real:default');",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes.map(({ mask }) => mask)).toEqual(["/real"]);
  });

  it("invalidates provenance after conditional receiver reassignment", () => {
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "$braced = new RouteList;",
      "if ($enabled) { $braced = makeRouter(); }",
      "$braced->addRoute('/braced', 'Bad:default');",
      "$single = new RouteList;",
      "if ($enabled) $single = makeRouter();",
      "$single->addRoute('/single', 'Bad:default');",
      "$reset = new RouteList;",
      "if ($enabled) { $reset = makeRouter(); }",
      "$reset = new RouteList;",
      "$reset->addRoute('/reset', 'Good:default');",
      "$shortCircuit = new RouteList;",
      "$enabled && ($shortCircuit = makeRouter());",
      "$shortCircuit->addRoute('/short-circuit', 'Bad:default');",
      "$plainBlock = new RouteList;",
      "{ $plainBlock = makeRouter(); }",
      "$plainBlock->addRoute('/plain-block', 'Bad:default');",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes.map(({ mask }) => mask)).toEqual(["/reset"]);
  });

  it("rejects unreachable registrations after function terminators without poisoning conditional exits", () => {
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "function returned(bool $stop) {",
      "  $router = new RouteList;",
      "  if ($stop) return $router;",
      "  $router->addRoute('/reachable', 'Good:default');",
      "  return $router;",
      "  $router->addRoute('/after-return', 'Bad:default');",
      "}",
      "function thrown() {",
      "  $router = new RouteList;",
      "  throw new RuntimeException();",
      "  $router->addRoute('/after-throw', 'Bad:default');",
      "}",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes.map(({ mask }) => mask)).toEqual(["/reachable"]);
  });

  it("does not leak an import alias across multiple PHP namespaces", () => {
    const source = [
      "<?php",
      "namespace App\\One {",
      "  use Nette\\Application\\Routers\\RouteList as Routes;",
      "}",
      "namespace App\\Two {",
      "  class Routes {}",
      "  function build() {",
      "    $router = new Routes;",
      "    $router->addRoute('/unrelated', 'Bad:default');",
      "  }",
      "}",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes).toEqual([]);
  });

  it("keeps a RouteList import inside its bracketed namespace scope", () => {
    const source = [
      "<?php",
      "namespace App\\One {",
      "  use Nette\\Application\\Routers\\RouteList as Routes;",
      "  function build() {",
      "    $router = new Routes;",
      "    $router->addRoute('/inside', 'Good:default');",
      "  }",
      "}",
      "namespace {",
      "  class Routes {}",
      "  $router = new Routes;",
      "  $router->addRoute('/outside', 'Bad:default');",
      "}",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes.map(({ mask }) => mask)).toEqual(["/inside"]);
  });

  it("does not treat class trait-use syntax as a namespace import", () => {
    const source = [
      "<?php",
      "class Factory {",
      "  use Nette\\Application\\Routers\\RouteList;",
      "  public function build() {",
      "    $router = new RouteList;",
      "    $router->addRoute('/invalid-import', 'Bad:default');",
      "  }",
      "}",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes).toEqual([]);
  });

  it("preserves every assigned withModule chain and rejects unrelated suffixes", () => {
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "$root = new RouteList('Front');",
      "$api = $root->withModule('Admin')->withModule('Api');",
      "$api->addRoute('/products', 'Product:list');",
      "$invalid = $root->withModule('Wrong')->other();",
      "$invalid->addRoute('/invalid', 'Bad:default');",
      "$constructed = new RouteList('Root')->withModule('Nested');",
      "$constructed->addRoute('/constructed', 'Home:default');",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes.map(({ mask, target }) => [mask, target?.raw])).toEqual([
      ["/products", "Front:Admin:Api:Product:list"],
      ["/constructed", "Root:Nested:Home:default"],
    ]);
  });

  it("supports named RouteList arguments and ignores unrelated nested metadata values", () => {
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "$router = new RouteList(module: 'Root',);",
      "$child = $router->withModule(module: 'Api',);",
      "$child->addRoute(",
      "  mask: '/named',",
      "  metadata: [",
      "    'presenter' => 'Product',",
      "    'action' => 'show',",
      "    'id' => [Route::Value => ['filter' => 'dynamic nested metadata']],",
      "  ],",
      "  oneWay: true,",
      ");",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes).toEqual([
      expect.objectContaining({
        mask: "/named",
        modulePrefix: "Root:Api",
        oneWay: true,
        target: expect.objectContaining({ raw: "Root:Api:Product:show" }),
      }),
    ]);
  });

  it("honours PHP-insensitive method names and rejects invalid named arguments", () => {
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "$router = new RouteList;",
      "$router->WITHMODULE('Api')->ADDROUTE('/case', 'Home:default');",
      "$router->addRoute(metadata: 'Bad:default', mask: '/reordered');",
      "$router->addRoute(mask: '/unknown', metadata: 'Bad:default', typo: false);",
      "$router->addRoute('/duplicate', mask: '/other', metadata: 'Bad:default');",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes.map(({ mask, target }) => [mask, target?.raw])).toEqual([
      ["/case", "Api:Home:default"],
      ["/reordered", "Bad:default"],
    ]);
  });

  it("does not confuse nested metadata with a flat presenter target", () => {
    const source = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "$router = new RouteList;",
      "$router->addRoute('/nested', [",
      "  'id' => [Route::Value => ['presenter' => 'Wrong', 'action' => 'wrong']],",
      "]);",
      "$router->addRoute('/real', ['presenter' => 'Real', 'action' => 'show',]);",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }]),
    );

    expect(result.routes.map(({ mask }) => mask)).toEqual(["/real"]);
  });

  it("uses dirty overlays but rejects outside and dot-segment sources", () => {
    const path = `${ROOT}/app/Router.php`;
    const disk = "<?php $r[] = new Route('/disk', 'Disk:default');";
    const dirty = "<?php $r[] = new Route('/dirty', 'Dirty:show');";
    const result = ok(
      projectNetteWorkspaceRoutes(
        ROOT,
        [
          { path, source: disk },
          { path: `${ROOT}/app/../outside/Router.php`, source: disk },
        ],
        [
          { path: "app/Router.php", source: dirty },
          { path: "../outside/Router.php", source: dirty },
        ],
      ),
    );

    expect(result.routes).toEqual([
      expect.objectContaining({
        mask: "/dirty",
        target: expect.objectContaining({ presenter: "Dirty", action: "show" }),
      }),
    ]);
  });

  it("applies overlays and route caps to modern RouteList registrations", () => {
    const path = `${ROOT}/app/Router.php`;
    const disk = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "$router = new RouteList;",
      "$router->addRoute('/disk', 'Disk:default');",
    ].join("\n");
    const dirty = [
      "<?php",
      "use Nette\\Application\\Routers\\RouteList;",
      "$router = new RouteList;",
      "$router->addRoute('/one', 'One:default');",
      "$router->addRoute('/two', 'Two:default');",
      "$router->addRoute('/three', 'Three:default');",
    ].join("\n");

    const result = ok(
      projectNetteWorkspaceRoutes(
        ROOT,
        [{ path, source: disk }],
        [{ path: "app/Router.php", source: dirty }],
        { maxRoutes: 2 },
      ),
    );

    expect(result.routes.map(({ mask }) => mask)).toEqual(["/one", "/two"]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("bounds parser work and reports a truncated lower-bound total", () => {
    const source = [
      "new Route('/one', 'One:default');",
      "new Route('/two', 'Two:default');",
      "new Route('/three', 'Three:default');",
      "new Route('/four', 'Four:default');",
    ].join("\n");
    const result = ok(
      projectNetteWorkspaceRoutes(ROOT, [{ path: `${ROOT}/app/Router.php`, source }], [], {
        maxRoutes: 2,
      }),
    );

    expect(result.routes.map((route) => route.mask)).toEqual(["/one", "/two"]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("returns unavailable without a root", () => {
    expect(projectNetteWorkspaceRoutes("", [])).toEqual({
      status: "unavailable",
      message: "No workspace is open.",
    });
  });
});
