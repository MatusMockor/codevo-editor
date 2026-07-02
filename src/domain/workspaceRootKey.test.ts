import { describe, expect, it } from "vitest";
import { workspaceDisplayName } from "./workspaceRootKey";

describe("workspaceDisplayName", () => {
  it("returns the last path segment as the project name", () => {
    expect(workspaceDisplayName("/Users/dev/projects/laravel-app")).toBe(
      "laravel-app",
    );
  });

  it("strips a trailing slash before taking the last segment", () => {
    expect(workspaceDisplayName("/workspace/my-project/")).toBe("my-project");
  });

  it("normalizes Windows-style backslashes", () => {
    expect(workspaceDisplayName("C:\\Users\\dev\\my-project")).toBe(
      "my-project",
    );
  });

  it("falls back to the raw path when there is no segment to extract", () => {
    expect(workspaceDisplayName("/")).toBe("/");
  });
});
