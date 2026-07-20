import { describe, expect, it } from "vitest";
import type { PhpIdentifierContext } from "./phpNavigation";
import { phpIdentifierContextAt } from "./phpNavigation";
import {
  isPhpLaravelIdentifierContext,
  phpLaravelRelationStringCompletionContextAt,
  phpLaravelRelationStringIdentifierContextAt,
  phpLaravelRequestMethodDefinition,
  phpLaravelRouteActionIdentifierContextAt,
  phpLaravelRouteActionMethodCompletionContextAt,
  type PhpLaravelIdentifierContext,
} from "./phpLaravelNavigationContexts";

function positionAt(source: string, needle: string, extraColumns = 1) {
  const offset = source.indexOf(needle);

  expect(offset).toBeGreaterThanOrEqual(0);

  const before = source.slice(0, offset);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return {
    column: offset - lineStart + extraColumns,
    lineNumber,
  };
}

describe("phpLaravelNavigationContexts", () => {
  it("classifies a route action string inside a controller tuple", () => {
    const source =
      "Route::get('/dashboard', [DashboardController::class, 'index']);";

    expect(
      phpLaravelRouteActionIdentifierContextAt(
        source,
        positionAt(source, "index", 2),
      ),
    ).toEqual({
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "index",
    });
  });

  it("classifies a relation string argument on an Eloquent call", () => {
    const source = "Post::with('comments')->get();";

    expect(
      phpLaravelRelationStringIdentifierContextAt(
        source,
        positionAt(source, "comments", 2),
      ),
    ).toEqual({
      className: "Post",
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: null,
      relationName: "comments",
    });
  });

  it("produces relation string completion contexts", () => {
    const source = "Post::with('com')->get();";

    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        positionAt(source, "com", 4),
      ),
    ).toEqual({
      className: "Post",
      methodName: "with",
      prefix: "com",
      receiverExpression: null,
    });
  });

  it("produces route action method completion contexts", () => {
    const source =
      "Route::get('/dashboard', [DashboardController::class, 'ind']);";

    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        source,
        positionAt(source, "ind']", 4),
      ),
    ).toEqual({
      className: "DashboardController",
      prefix: "ind",
    });
  });

  it("maps request helper methods onto Laravel concerns", () => {
    expect(phpLaravelRequestMethodDefinition("StoreRequest", "input")).toEqual({
      className: "Illuminate\\Http\\Concerns\\InteractsWithInput",
      methodName: "input",
    });
    expect(
      phpLaravelRequestMethodDefinition("StoreRequest", "boolean"),
    ).toEqual({
      className: "Illuminate\\Support\\Traits\\InteractsWithData",
      methodName: "boolean",
    });
    expect(phpLaravelRequestMethodDefinition(null, "input")).toBeNull();
    expect(phpLaravelRequestMethodDefinition("PostService", "input")).toBeNull();
  });

  it("recognizes Laravel contexts through the framework context guard", () => {
    const laravelContext: PhpLaravelIdentifierContext = {
      kind: "laravelNamedRouteString",
      routeName: "dashboard",
    };

    expect(isPhpLaravelIdentifierContext(laravelContext)).toBe(true);
  });

  it("keeps Laravel contexts assignable to the extended identifier union", () => {
    const context: PhpIdentifierContext = {
      configKey: "app.name",
      kind: "laravelConfigString",
    };

    expect(isPhpLaravelIdentifierContext(context)).toBe(true);
  });

  it("rejects core PHP contexts in the framework context guard", () => {
    const source = "$service->run();";
    const coreContext = phpIdentifierContextAt(
      source,
      positionAt(source, "run", 2),
    );

    expect(coreContext).toEqual({
      kind: "methodCall",
      methodName: "run",
      receiverExpression: "$service",
      variableName: "service",
    });
    expect(coreContext && isPhpLaravelIdentifierContext(coreContext)).toBe(
      false,
    );
    const classContext: PhpIdentifierContext = {
      kind: "classIdentifier",
      name: "PostService",
    };

    expect(isPhpLaravelIdentifierContext(classContext)).toBe(false);
  });
});
