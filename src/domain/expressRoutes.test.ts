import { describe, expect, it } from "vitest";
import { expressRoutesInSource, expressRoutesInSourceBounded } from "./expressRoutes";

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
});
