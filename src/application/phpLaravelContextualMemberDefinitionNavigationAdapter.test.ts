import { describe, expect, it } from "vitest";
import { phpLaravelContextualMemberDefinitionNavigationAdapter as adapter } from "./phpLaravelContextualMemberDefinitionNavigationAdapter";

describe("phpLaravelContextualMemberDefinitionNavigationAdapter", () => {
  it("supports builder model navigation", () => {
    expect(adapter.supportsBuilderModelNavigation()).toBe(true);
  });

  it("delegates request method definition hints", () => {
    expect(
      adapter.requestMethodDefinitionHint(
        "App\\Http\\Requests\\StorePostRequest",
        "input",
      ),
    ).toEqual({
      className: "Illuminate\\Http\\Concerns\\InteractsWithInput",
      methodName: "input",
    });
    expect(
      adapter.requestMethodDefinitionHint("App\\Models\\Post", "input"),
    ).toBeNull();
  });

  it("delegates local scope method names", () => {
    expect(adapter.localScopeMethodName("published")).toBe("scopePublished");
    expect(adapter.localScopeMethodName("not-valid")).toBeNull();
  });

  it("passes non-null dynamic where target classes through unchanged", () => {
    expect(adapter.dynamicWhereTargetClassName("App\\Models\\Post")).toBe(
      "App\\Models\\Post",
    );
    expect(adapter.dynamicWhereTargetClassName(null)).toBeNull();
  });

  it("delegates Eloquent Builder method recognition", () => {
    expect(adapter.staticBuilderTargetClassName("where")).toBe(
      "Illuminate\\Database\\Eloquent\\Builder",
    );
    expect(adapter.staticBuilderTargetClassName("domainMethod")).toBeNull();
  });
});
