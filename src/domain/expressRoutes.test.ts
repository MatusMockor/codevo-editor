import { describe, expect, it } from "vitest";
import {
  expressRoutesForReceiversInSourceBounded,
  expressRoutesInSource,
  expressRoutesInSourceBounded,
} from "./expressRoutes";

describe("expressRoutesInSource", () => {
  it("extracts literal app and router routes in source order", () => {
    const source = [
      "app.get('/users', listUsers);",
      'router.post("/users", createUser);',
      "app.use('/api', apiRouter);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toEqual([
      {
        column: 1,
        line: 1,
        method: "GET",
        path: "/users",
        receiver: "app",
      },
      {
        column: 1,
        line: 2,
        method: "POST",
        path: "/users",
        receiver: "router",
      },
      {
        column: 1,
        line: 3,
        method: "USE",
        path: "/api",
        receiver: "app",
      },
    ]);
  });

  it("stops a mixed direct and chained stream after one overflow route", () => {
    const source = [
      "router.route('/chain').get(first).post(second);",
      "app.delete('/direct', third);",
      "router.put('/overflow', fourth);",
    ].join("\n");

    const result = expressRoutesInSourceBounded(source, 3);

    expect(result.routes.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "GET", path: "/chain" },
      { method: "POST", path: "/chain" },
      { method: "DELETE", path: "/direct" },
    ]);
    expect(result.truncated).toBe(true);
  });

  it("keeps nested chained declarations interleaved in exact source order", () => {
    const source = [
      "router.route('/outer')",
      "  .get(() => { router.route('/inner').post(inner); })",
      "  .delete(removeOuter);",
    ].join("\n");

    expect(expressRoutesInSource(source).map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "GET", path: "/outer" },
      { method: "POST", path: "/inner" },
      { method: "DELETE", path: "/outer" },
    ]);
  });

  it("extracts every method chained from a literal route call", () => {
    const source = [
      "router",
      "  .route('/accounts/:id')",
      "  .get(showAccount)",
      "  .patch(updateAccount)",
      "  .delete(deleteAccount);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toEqual([
      {
        column: 3,
        line: 3,
        method: "GET",
        path: "/accounts/:id",
        receiver: "router",
      },
      {
        column: 3,
        line: 4,
        method: "PATCH",
        path: "/accounts/:id",
        receiver: "router",
      },
      {
        column: 3,
        line: 5,
        method: "DELETE",
        path: "/accounts/:id",
        receiver: "router",
      },
    ]);
  });

  it("ignores dynamic paths and route-shaped text in comments and strings", () => {
    const source = [
      "app.get(prefix + '/users', handler);",
      "app.get('/users/' + userId, handler);",
      "router.post(routePath, handler);",
      "// app.delete('/not-a-route', handler);",
      "const example = \"router.put('/also-not-a-route', handler)\";",
      "app.get(`/template/${id}`, handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toEqual([]);
  });

  it("keeps duplicate paths and supports trivia before the literal", () => {
    const source = ["app.get( /* public */ '/health', first);", "app.get('/health', second);"].join(
      "\n",
    );

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 1, method: "GET", path: "/health" },
      { line: 2, method: "GET", path: "/health" },
    ]);
  });

  it("ignores route-shaped regex literals", () => {
    const source = [
      "const example = /app.get('\\/ghost', handler)/;",
      "app.get('/real', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 2, method: "GET", path: "/real" },
    ]);
  });

  it("balances nested chained handlers containing semicolons", () => {
    const source = [
      "router.route('/accounts/:id')",
      "  .get((request, response) => { response.send(read(request)); })",
      "  .post(authenticate(check()), createAccount);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 2, column: 3, method: "GET", path: "/accounts/:id" },
      { line: 3, column: 3, method: "POST", path: "/accounts/:id" },
    ]);
  });

  it("decodes unambiguous JavaScript string escapes", () => {
    const source = [
      String.raw`app.get('/caf\u00e9', first);`,
      String.raw`app.get('\x2fhealth', second);`,
      String.raw`app.get('/quote\'s\\path', third);`,
    ].join("\n");

    expect(expressRoutesInSource(source).map((route) => route.path)).toEqual([
      "/café",
      "/health",
      "/quote's\\path",
    ]);
  });

  it("rejects ambiguous legacy escapes instead of publishing a wrong path", () => {
    expect(expressRoutesInSource(String.raw`app.get('/legacy\8', handler);`)).toEqual([]);
  });

  it("requires lowercase Express verb properties", () => {
    expect(expressRoutesInSource("app.GET('/ghost', handler);")).toEqual([]);
  });

  it("rejects app and router names reached through property chains", () => {
    const source = [
      "server.app.get('/member', handler);",
      "server?.app.post('/optional', handler);",
      "server . router . use('/spaced', middleware);",
      "server.app.route('/chained').get(handler);",
      "app.get('/standalone', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 5, method: "GET", path: "/standalone", receiver: "app" },
    ]);
  });

  it("ignores route-shaped regex literals after control headers", () => {
    const source = [
      "if (enabled) /app.get('\\/if-ghost', handler)/.test(source);",
      "while (ready()) /router.post('\\/while-ghost', handler)/.test(source);",
      "app.get('/real', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 3, method: "GET", path: "/real", receiver: "app" },
    ]);
  });

  it("rejects routes through lexically shadowed app and router bindings", () => {
    const source = [
      "app.get('/outer', handler);",
      "function configure(app: unknown) { app.get('/parameter-ghost', handler); }",
      "function nested() {",
      "  router.get('/tdz-ghost', handler);",
      "  const router = customRouter();",
      "  router.post('/local-ghost', handler);",
      "}",
      "const configure = (app: unknown) => { app.patch('/arrow-ghost', handler); };",
      "router.get('/router-outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source).map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "GET", path: "/outer" },
      { method: "GET", path: "/router-outer" },
    ]);
  });

  it("keeps outer receivers referenced from an unshadowed nested function", () => {
    const source = [
      "function registerRoutes() {",
      "  app.get('/nested-but-authoritative', handler);",
      "}",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 2, method: "GET", path: "/nested-but-authoritative", receiver: "app" },
    ]);
  });

  it("scopes for-loop bindings without hiding the outer receiver after the loop", () => {
    const source = [
      "function registerRoutes(items: unknown[]) {",
      "  for (const app of items) { app.get('/loop-ghost', handler); }",
      "  app.get('/after-loop', handler);",
      "}",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 3, method: "GET", path: "/after-loop", receiver: "app" },
    ]);
  });

  it("rejects generator and expression-arrow parameter shadows", () => {
    const source = [
      "function* configure(app: unknown) { app.get('/generator-ghost', handler); }",
      "const configureOne = (app: unknown) => app.get('/arrow-expression-ghost', handler);",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 3, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("rejects function-scoped var, destructured, and method parameter shadows", () => {
    const source = [
      "function configure() {",
      "  if (enabled) { var app = customRouter(); }",
      "  app.get('/function-var-ghost', handler);",
      "}",
      "const configureOne = ({ app }: { app: unknown }) => app.get('/destructure-ghost', handler);",
      "class Routes { configure(app: unknown) { app.get('/method-ghost', handler); } }",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 7, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("fails closed when adversarial brace structure exceeds the lexical budget", () => {
    const source = `app.get('/hidden', handler);${"{}".repeat(20_001)}`;

    expect(expressRoutesInSourceBounded(source, 100)).toEqual({
      routes: [],
      truncated: true,
    });
  });

  it("does not treat a module-local conventional name as the implicit Express receiver", () => {
    const source = "const app = custom(); app.get('/ghost', handler);";

    expect(expressRoutesInSource(source)).toEqual([]);
  });

  it("keeps a conventional receiver initialized by an Express factory", () => {
    const source = "const app = express(); app.get('/real', handler);";

    expect(expressRoutesInSource(source)).toMatchObject([
      { method: "GET", path: "/real", receiver: "app" },
    ]);
  });

  it("limits an unbraced for binding to its loop statement", () => {
    const source = [
      "function register(items: unknown[]) {",
      "  for (const app of items) app.get('/loop-ghost', handler);",
      "  app.get('/after-loop', handler);",
      "}",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 3, method: "GET", path: "/after-loop", receiver: "app" },
    ]);
  });

  it("keeps a multiline parenthesized arrow body under its parameter shadow", () => {
    const source = [
      "const register = (app: unknown) =>",
      "  (",
      "    app.get('/multiline-arrow-ghost', handler)",
      "  );",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 5, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("tracks a lexical binding through nested unbraced for statements", () => {
    const source = [
      "function register(items: unknown[]) {",
      "  for (const app of items) for (;;) app.get('/nested-loop-ghost', handler);",
      "  app.get('/after-loop', handler);",
      "}",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 3, method: "GET", path: "/after-loop", receiver: "app" },
    ]);
  });

  it("recognizes parameter shadows with nested initializer parentheses", () => {
    const source = [
      "function register(app = make()) { app.get('/default-ghost', handler); }",
      "const registerArrow = (value: unknown, app = make()) => app.get('/arrow-default-ghost', handler);",
      "class Routes { register(value: unknown, app = make()) { app.get('/method-default-ghost', handler); } }",
      "const registerObject = ({ app } = make()) => app.get('/arrow-object-ghost', handler);",
      "class ObjectRoutes { register({ app } = make()) { app.get('/method-object-ghost', handler); } }",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 6, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("indexes a large receiver allowlist instead of testing every receiver per declaration", () => {
    const receiverCount = 2_000;
    const receivers = Array.from({ length: receiverCount }, (_, index) => `router${index}`);
    const source = receivers
      .map(
        (receiver, index) =>
          `function configure${index}(${receiver}) { ${receiver}.get('/ghost', handler); }`,
      )
      .join("\n");

    const startedAt = performance.now();
    const result = expressRoutesForReceiversInSourceBounded(source, receivers, 100);

    expect(result).toEqual({ routes: [], truncated: false });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("keeps a receiver shadowed by a method parameter list beyond the local scan window", () => {
    const source = [
      `class Routes { configure(app, ${"argument".repeat(700)}) { app.get('/ghost', handler); } }`,
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSourceBounded(source, 100)).toEqual({
      routes: [
        {
          column: 1,
          line: 2,
          method: "GET",
          path: "/outer",
          receiver: "app",
        },
      ],
      truncated: false,
    });
  });

  it("keeps destructured for and catch bindings scoped away from outer routes", () => {
    const source = [
      "for (const { app } of items) { app.get('/for-ghost', handler); }",
      "try { work(); } catch ({ app }) { app.get('/catch-ghost', handler); }",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 3, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("does not treat computed destructuring keys as receiver bindings", () => {
    const source = [
      "function configure({ [app]: value }) { app.get('/function-real', handler); }",
      "{ const { [app]: value } = object; app.get('/block-real', handler); }",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 1, method: "GET", path: "/function-real", receiver: "app" },
      { line: 2, method: "GET", path: "/block-real", receiver: "app" },
    ]);
  });

  it("keeps typed array destructuring parameters as receiver bindings", () => {
    const source = [
      "function configure([app]: unknown[]) { app.get('/function-ghost', handler); }",
      "const configureArrow = ([app]: unknown[]) => app.get('/arrow-ghost', handler);",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 3, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("hoists var bindings to their module or static-block scope", () => {
    const source = [
      "if (enabled) { var router = other(); }",
      "router.get('/module-ghost', handler);",
      "class Routes { static { var app = other(); app.get('/static-ghost', handler); } }",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 4, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("limits named function and class expression bindings to their own bodies", () => {
    const source = [
      "const callback = function app() { app.get('/function-ghost', handler); };",
      "app.get('/after-function', handler);",
      "const Type = class app { method() { app.get('/class-ghost', handler); } };",
      "app.get('/after-class', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 2, method: "GET", path: "/after-function", receiver: "app" },
      { line: 4, method: "GET", path: "/after-class", receiver: "app" },
    ]);
  });

  it("recognizes async, generator, returned, new, and heritage named expressions", () => {
    const source = [
      "const asyncCallback = async function app() { app.get('/async-ghost', handler); };",
      "const generator = function* app() { app.get('/generator-ghost', handler); };",
      "const factory = () => function app() { app.get('/returned-ghost', handler); };",
      "const Instance = new class app { method() { app.get('/new-class-ghost', handler); } };",
      "const Mixed = class app extends mixin({ value: 1 }) { method() { app.get('/heritage-ghost', handler); } };",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 6, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("keeps named expressions after logical and binary operators body-local", () => {
    const source = [
      "const andValue = enabled && function app() { app.get('/and-ghost', handler); };",
      "const orValue = fallback || function app() { app.get('/or-ghost', handler); };",
      "const added = value + function app() { app.get('/plus-ghost', handler); };",
      "app.get('/outer', handler);",
    ].join("\n");

    expect(expressRoutesInSource(source)).toMatchObject([
      { line: 4, method: "GET", path: "/outer", receiver: "app" },
    ]);
  });

  it("indexes lexical binding scopes without rescanning each preceding block", () => {
    const source = `${"{ const app = other(); }".repeat(15_000)}app.get('/outer', handler);`;

    const startedAt = performance.now();
    const result = expressRoutesInSourceBounded(source, 100);

    expect(result.routes).toMatchObject([{ method: "GET", path: "/outer", receiver: "app" }]);
    expect(result.truncated).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("rejects many unmatched route calls without repeatedly scanning the remaining source", () => {
    const source = "router.route('/x', handler;\n".repeat(8_000);

    const startedAt = performance.now();
    const result = expressRoutesInSourceBounded(source, 100);

    expect(result).toEqual({ routes: [], truncated: false });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
