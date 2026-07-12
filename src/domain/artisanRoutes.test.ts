import { describe, expect, it } from "vitest";
import {
  artisanControllerAction,
  filterArtisanRoutes,
  type ArtisanRoute,
} from "./artisanRoutes";

const routes: ArtisanRoute[] = [
  {
    methods: ["GET", "HEAD"],
    uri: "users/{user}",
    name: "users.show",
    action: "App\\Http\\Controllers\\UserController@show",
  },
  {
    methods: ["POST"],
    uri: "login",
    name: "login",
    action: "Closure",
  },
  {},
];

describe("filterArtisanRoutes", () => {
  it.each([
    ["", 3],
    [" users ", 1],
    ["SHOW", 1],
    ["controller", 1],
    ["head", 1],
    ["post", 1],
    ["missing", 0],
  ])("filters %j across route fields", (query, count) => {
    expect(filterArtisanRoutes(routes, query)).toHaveLength(count);
  });

  it("does not mutate the source array", () => {
    expect(filterArtisanRoutes(routes, "")).not.toBe(routes);
  });
});

describe("artisanControllerAction", () => {
  it("parses method and invokable controller actions", () => {
    expect(
      artisanControllerAction(
        "\\App\\Http\\Controllers\\UserController@show",
      ),
    ).toEqual({
      className: "App\\Http\\Controllers\\UserController",
      methodName: "show",
    });
    expect(artisanControllerAction("App\\InvokableController")).toEqual({
      className: "App\\InvokableController",
      methodName: "__invoke",
    });
    expect(artisanControllerAction("SingleController")).toEqual({
      className: "SingleController",
      methodName: "__invoke",
    });
  });

  it("rejects closures, empty actions, and non-class strings", () => {
    expect(artisanControllerAction("Closure")).toBeNull();
    expect(artisanControllerAction("")).toBeNull();
    expect(artisanControllerAction("not a class")).toBeNull();
    expect(artisanControllerAction("function_name")).toBeNull();
  });
});
