import { describe, expect, it } from "vitest";
import {
  abbreviateHomePath,
  cloneDestinationRefusal,
  defaultCloneParentPath,
  expandHomePath,
  isDefaultCloneParent,
  joinClonePath,
  resolveCloneDestination,
  suggestCloneFolderName,
} from "./cloneDestination";
import {
  WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL,
  WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL,
  WORKSPACE_ROOT_HOME_REFUSAL,
} from "./workspaceRootEligibility";

const home = "/Users/dev";
const homeReference = { path: home, pathCase: "insensitive" } as const;

describe("clone destination", () => {
  it("defaults to ~/code and prefers the last parent folder", () => {
    expect(defaultCloneParentPath(home, null)).toBe("/Users/dev/code");
    expect(defaultCloneParentPath(home, "/Volumes/work/src")).toBe("/Volumes/work/src");
    expect(isDefaultCloneParent("/Users/dev/code/", home)).toBe(true);
    expect(isDefaultCloneParent("/Users/dev/src", home)).toBe(false);
    expect(isDefaultCloneParent("/Users/dev/code", null)).toBe(false);
  });

  it("suggests a valid folder name from any repository path", () => {
    expect(suggestCloneFolderName({ host: "github.com", path: "acme/web-dashboard" })).toBe(
      "web-dashboard",
    );
    expect(suggestCloneFolderName({ host: "github.com", path: "acme/orders.api" })).toBe(
      "orders-api",
    );
    expect(suggestCloneFolderName({ host: "github.com", path: "acme/.dotfiles" })).toBe("dotfiles");
    expect(suggestCloneFolderName({ host: "github.com", path: "acme/___" })).toBe("repository");
    expect(suggestCloneFolderName({ host: "x.io", path: `a/${"b".repeat(80)}` })).toHaveLength(64);
  });

  it("abbreviates and expands the home folder", () => {
    expect(abbreviateHomePath("/Users/dev/code/app", home)).toBe("~/code/app");
    expect(abbreviateHomePath("/Users/devtools/app", home)).toBe("/Users/devtools/app");
    expect(abbreviateHomePath("/Users/dev", home)).toBe("~");
    expect(expandHomePath("~/code/app", home)).toBe("/Users/dev/code/app");
    expect(expandHomePath("~", home)).toBe("/Users/dev");
    expect(expandHomePath("/opt/app", home)).toBe("/opt/app");
    expect(expandHomePath("~/code/app", null)).toBeNull();
    expect(expandHomePath("code/app", home)).toBeNull();
    expect(expandHomePath("~other/app", home)).toBeNull();
  });

  it("resolves a destination into parent and folder name", () => {
    expect(resolveCloneDestination("~/code/web-dashboard/", home)).toEqual({
      kind: "ok",
      path: "/Users/dev/code/web-dashboard",
      parentPath: "/Users/dev/code",
      name: "web-dashboard",
    });
    expect(resolveCloneDestination("/web", home)).toEqual({
      kind: "ok",
      path: "/web",
      parentPath: "/",
      name: "web",
    });
    for (const bad of [
      "",
      "web",
      "~/code/bad name",
      "~/code/../x",
      "~/code/.hidden",
      "/",
      `/a/${"b".repeat(65)}`,
    ]) {
      expect(resolveCloneDestination(bad, home)).toEqual({ kind: "invalid" });
    }
    expect(resolveCloneDestination(`/${"a".repeat(4100)}/x`, home)).toEqual({ kind: "invalid" });
    expect(joinClonePath("/", "x")).toBe("/x");
    expect(joinClonePath("/a/", "x")).toBe("/a/x");
  });

  it("refuses the home folder, the disk root and ancestors of home as destinations", () => {
    expect(cloneDestinationRefusal("/Users/dev", homeReference)).toBe(WORKSPACE_ROOT_HOME_REFUSAL);
    expect(cloneDestinationRefusal("/Users/dev/", homeReference)).toBe(WORKSPACE_ROOT_HOME_REFUSAL);
    expect(cloneDestinationRefusal("/", homeReference)).toBe(
      WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL,
    );
    expect(cloneDestinationRefusal("/", { path: null, pathCase: "sensitive" })).toBe(
      WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL,
    );
    expect(cloneDestinationRefusal("/Users", homeReference)).toBe(
      WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL,
    );
    expect(cloneDestinationRefusal("/users", homeReference)).toBe(
      WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL,
    );
  });

  it("always accepts the default ~/code/<name> destination", () => {
    const path = joinClonePath(defaultCloneParentPath(home, null), "web-dashboard");
    expect(cloneDestinationRefusal(path, homeReference)).toBeNull();
    expect(cloneDestinationRefusal("/Users/devtools", homeReference)).toBeNull();
    expect(cloneDestinationRefusal("/opt/work/app", homeReference)).toBeNull();
  });
});
