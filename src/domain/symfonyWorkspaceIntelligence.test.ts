import { describe, expect, it } from "vitest";
import {
  filterSymfonyConsoleCommands,
  filterSymfonyRoutes,
  filterSymfonyServices,
  parseSymfonyConsoleCommandsResult,
  parseSymfonyControllerAction,
  parseSymfonyRoutesResult,
  parseSymfonyServicesResult,
  symfonyRouteNavigationTarget,
  symfonyServiceNavigationTarget,
} from "./symfonyWorkspaceIntelligence";

describe("Symfony workspace intelligence result parsing", () => {
  it("normalizes, sorts, and gives commands stable keys", () => {
    const first = parseSymfonyConsoleCommandsResult({
      status: "ok",
      commands: [
        { name: "cache:warmup", description: "Warm cache", aliases: [] },
        { name: " about ", description: " Application info ", aliases: ["info"] },
      ],
      total: 2,
      truncated: false,
    });
    const reversed = parseSymfonyConsoleCommandsResult({
      status: "ok",
      commands: [
        { name: "about", description: "Application info", aliases: ["info"] },
        { name: "cache:warmup", description: "Warm cache", aliases: [] },
      ],
      total: 2,
      truncated: false,
    });

    expect(first).toEqual(reversed);
    expect(first.status === "ok" && first.commands.map(({ name }) => name)).toEqual([
      "about",
      "cache:warmup",
    ]);
  });

  it("rejects conflicting semantic identities instead of producing ambiguous keys", () => {
    expect(() =>
      parseSymfonyConsoleCommandsResult({
        status: "ok",
        commands: [
          { name: "about", description: "Conflicting description", aliases: ["info"] },
          { name: "about", description: "About", aliases: [] },
        ],
        total: 2,
        truncated: false,
      }),
    ).toThrow("unambiguous unique entry");
  });

  it("parses routes deterministically", () => {
    const result = parseSymfonyRoutesResult({
      status: "ok",
      routes: [
        {
          name: "app_user",
          path: "/users/{id}",
          methods: ["get", "HEAD"],
          controller: "App\\Controller\\UserController::show",
        },
      ],
      total: 1,
      truncated: true,
    });

    expect(result).toMatchObject({
      status: "ok",
      truncated: true,
      routes: [
        {
          name: "app_user",
          methods: ["GET", "HEAD"],
        },
      ],
    });
  });

  it("parses services and keeps visibility explicit", () => {
    expect(
      parseSymfonyServicesResult({
        status: "ok",
        services: [
          { id: "app.mailer", className: "App\\Mailer", alias: null, public: false },
          { id: "App\\Controller\\HomeController", className: null, alias: "home", public: true },
        ],
        total: 2,
        truncated: false,
      }),
    ).toMatchObject({
      status: "ok",
      services: [
        { id: "App\\Controller\\HomeController", alias: "home", public: true },
        { id: "app.mailer", className: "App\\Mailer", public: false },
      ],
    });
  });

  it.each(["unavailable", "error"] as const)("parses %s results", (status) => {
    expect(parseSymfonyRoutesResult({ status, message: "Console is unavailable" })).toEqual({
      status,
      message: "Console is unavailable",
    });
  });

  it.each([
    null,
    {},
    { status: "mystery" },
    { status: "ok", commands: [], total: 0, truncated: false, extra: true },
    { status: "ok", commands: "no", total: 0, truncated: false },
    {
      status: "ok",
      commands: [{ name: "x", description: "", aliases: [], extra: 1 }],
      total: 1,
      truncated: false,
    },
    { status: "unavailable", message: "", extra: 1 },
  ])("rejects malformed command result %#", (value) => {
    expect(() => parseSymfonyConsoleCommandsResult(value)).toThrow(TypeError);
  });

  it.each([
    {
      status: "ok",
      routes: [{ name: "r", path: "/", methods: null, controller: null }],
      total: 1,
      truncated: false,
    },
    {
      status: "ok",
      routes: [{ name: "r", path: "", methods: [], controller: null }],
      total: 1,
      truncated: false,
    },
    {
      status: "ok",
      routes: [{ name: "r", path: "/", methods: [], controller: null, source: {} }],
      total: 1,
      truncated: false,
    },
  ])("rejects malformed route result %#", (value) => {
    expect(() => parseSymfonyRoutesResult(value)).toThrow(TypeError);
  });

  it.each([
    {
      status: "ok",
      services: [{ id: "service", className: null, alias: null, public: 1 }],
      total: 1,
      truncated: false,
    },
    {
      status: "ok",
      services: [{ id: "", className: null, alias: null, public: false }],
      total: 1,
      truncated: false,
    },
    {
      status: "ok",
      services: [
        { id: "service", className: null, alias: null, public: false, class_name: "Wrong" },
      ],
      total: 1,
      truncated: false,
    },
  ])("rejects malformed service result %#", (value) => {
    expect(() => parseSymfonyServicesResult(value)).toThrow(TypeError);
  });

  it("enforces item, child-array, and string bounds", () => {
    expect(() =>
      parseSymfonyConsoleCommandsResult({
        status: "ok",
        commands: Array(4_001).fill({}),
        total: 4_001,
        truncated: true,
      }),
    ).toThrow("at most 4000 entries");
    expect(() =>
      parseSymfonyRoutesResult({
        status: "ok",
        routes: Array(10_001).fill({}),
        total: 10_001,
        truncated: true,
      }),
    ).toThrow("at most 10000 entries");
    expect(() =>
      parseSymfonyServicesResult({
        status: "ok",
        services: Array(20_001).fill({}),
        total: 20_001,
        truncated: true,
      }),
    ).toThrow("at most 20000 entries");
    expect(() =>
      parseSymfonyRoutesResult({
        status: "ok",
        routes: [{ name: "r", path: "/", methods: Array(33).fill("GET"), controller: null }],
        total: 1,
        truncated: false,
      }),
    ).toThrow("at most 32 entries");
    expect(() =>
      parseSymfonyServicesResult({
        status: "ok",
        services: [{ id: "x".repeat(4_097), className: null, alias: null, public: false }],
        total: 1,
        truncated: false,
      }),
    ).toThrow("at most 4096 characters");
  });

  it("normalizes child ordering and rejects values that normalize ambiguously", () => {
    const commands = parseSymfonyConsoleCommandsResult({
      status: "ok",
      commands: [{ name: "about", description: "", aliases: ["z", " a "] }],
      total: 1,
      truncated: false,
    });
    expect(commands.status === "ok" && commands.commands[0]?.aliases).toEqual(["a", "z"]);

    expect(() =>
      parseSymfonyRoutesResult({
        status: "ok",
        routes: [{ name: "r", path: "/", methods: ["get", "GET"], controller: null }],
        total: 1,
        truncated: false,
      }),
    ).toThrow("unambiguous unique entry");
  });

  it("rejects conflicting route names and service ids", () => {
    expect(() =>
      parseSymfonyRoutesResult({
        status: "ok",
        routes: [
          { name: "home", path: "/", methods: [], controller: null },
          { name: "home", path: "/start", methods: [], controller: null },
        ],
        total: 2,
        truncated: false,
      }),
    ).toThrow("unambiguous unique entry");
    expect(() =>
      parseSymfonyServicesResult({
        status: "ok",
        services: [
          { id: "mailer", className: "App\\Mailer", alias: null, public: false },
          { id: "mailer", className: "App\\OtherMailer", alias: null, public: false },
        ],
        total: 2,
        truncated: false,
      }),
    ).toThrow("unambiguous unique entry");
  });

  it("validates total against returned and truncated state", () => {
    expect(() =>
      parseSymfonyRoutesResult({ status: "ok", routes: [], total: 1, truncated: false }),
    ).toThrow("returned entry count");
    expect(
      parseSymfonyRoutesResult({ status: "ok", routes: [], total: 1, truncated: true }),
    ).toMatchObject({ status: "ok", total: 1, truncated: true });
  });
});

describe("Symfony filtering and navigation", () => {
  const commandResult = parseSymfonyConsoleCommandsResult({
    status: "ok",
    commands: [{ name: "cache:clear", description: "Clear cache", aliases: ["cc"] }],
    total: 1,
    truncated: false,
  });
  const commands = commandResult.status === "ok" ? commandResult.commands : [];

  it("filters commands, routes, and services without mutating inputs", () => {
    expect(filterSymfonyConsoleCommands(commands, " CC ")).toHaveLength(1);
    expect(filterSymfonyConsoleCommands(commands, "")).not.toBe(commands);
    expect(
      filterSymfonyRoutes(
        [{ key: "r", name: "user_show", path: "/users", methods: ["GET"], controller: null }],
        "get",
      ),
    ).toHaveLength(1);
    expect(
      filterSymfonyServices(
        [{ key: "s", id: "app.mailer", className: "App\\Mailer", alias: null, public: false }],
        "private",
      ),
    ).toHaveLength(1);
  });

  it.each([
    [
      "App\\Controller\\UserController::show",
      { className: "App\\Controller\\UserController", methodName: "show" },
    ],
    [
      "\\App\\Controller\\UserController",
      { className: "App\\Controller\\UserController", methodName: "__invoke" },
    ],
    [
      "App\\Controller\\Åction::__invoke",
      { className: "App\\Controller\\Åction", methodName: "__invoke" },
    ],
  ])("parses controller action %s", (value, expected) => {
    expect(parseSymfonyControllerAction(value)).toEqual(expected);
  });

  it.each([undefined, "", "Closure", "service.id::run", "App\\C::", "App\\C::a::b", "::run"])(
    "rejects ambiguous or dynamic controller action %s",
    (value) => expect(parseSymfonyControllerAction(value)).toBeNull(),
  );

  it("navigates a route to its explicit controller method", () => {
    expect(
      symfonyRouteNavigationTarget({
        key: "r",
        name: "route",
        path: "/",
        methods: [],
        controller: "App\\Controller\\HomeController::index",
      }),
    ).toEqual({
      kind: "phpMethod",
      className: "App\\Controller\\HomeController",
      methodName: "index",
    });
  });

  it("navigates services by explicit class, class-like id, or class-like alias", () => {
    expect(
      symfonyServiceNavigationTarget({
        key: "s",
        id: "mailer",
        className: "App\\Mailer",
        alias: null,
        public: false,
      }),
    ).toEqual({ kind: "phpClass", className: "App\\Mailer" });
    expect(
      symfonyServiceNavigationTarget({
        key: "s",
        id: "App\\Mailer",
        className: null,
        alias: null,
        public: false,
      }),
    ).toEqual({ kind: "phpClass", className: "App\\Mailer" });
    expect(
      symfonyServiceNavigationTarget({
        key: "s",
        id: "app.mailer",
        className: null,
        alias: null,
        public: false,
      }),
    ).toBeNull();
    expect(
      symfonyServiceNavigationTarget({
        key: "s",
        id: "app.mailer",
        className: null,
        alias: "\\App\\Mailer",
        public: null,
      }),
    ).toEqual({ kind: "phpClass", className: "App\\Mailer" });
  });
});
