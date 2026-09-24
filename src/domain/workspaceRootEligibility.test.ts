import { describe, expect, it } from "vitest";
import {
  isEligibleWorkspaceRoot,
  UNKNOWN_WORKSPACE_HOME,
  WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL,
  WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL,
  WORKSPACE_ROOT_HOME_REFUSAL,
  workspaceRootEligibility,
  workspaceRootRefusalMessage,
  type WorkspaceHomeReference,
} from "./workspaceRootEligibility";

const HOME = "/Users/me";
const MAC_HOME: WorkspaceHomeReference = { path: HOME, pathCase: "insensitive" };

describe("workspaceRootEligibility", () => {
  it.each([HOME, `${HOME}/`, `${HOME}//`, "/users/ME", `${HOME}/.`, `${HOME}/Developer/..`])(
    "refuses the home folder spelled as %s",
    (rootPath) => {
      expect(workspaceRootEligibility(rootPath, MAC_HOME)).toEqual({
        kind: "refused",
        reason: "home",
      });
    },
  );

  it("refuses home when the home path itself carries a trailing slash", () => {
    expect(workspaceRootEligibility(HOME, { path: `${HOME}/`, pathCase: "insensitive" })).toEqual({
      kind: "refused",
      reason: "home",
    });
  });

  it.each(["/", "//", "", "   ", "/..", "C:\\", "c:/"])(
    "refuses the filesystem root spelled as %j",
    (rootPath) => {
      expect(workspaceRootEligibility(rootPath, MAC_HOME)).toEqual({
        kind: "refused",
        reason: "filesystemRoot",
      });
    },
  );

  it.each(["/Users", "/Users/", "/users"])("refuses the home ancestor %s", (rootPath) => {
    expect(workspaceRootEligibility(rootPath, MAC_HOME)).toEqual({
      kind: "refused",
      reason: "homeAncestor",
    });
  });

  it.each([
    `${HOME}/Developer/app`,
    `${HOME}/Documents`,
    "/Users/me2",
    "/Users/me2/app",
    "/Users/other",
    "/opt/project",
  ])("accepts %s", (rootPath) => {
    expect(workspaceRootEligibility(rootPath, MAC_HOME)).toEqual({ kind: "eligible" });
    expect(isEligibleWorkspaceRoot(rootPath, MAC_HOME)).toBe(true);
  });

  it.each([null, "", "/"])("still refuses only the filesystem root when home is %j", (path) => {
    const home: WorkspaceHomeReference = { path, pathCase: "insensitive" };
    expect(workspaceRootEligibility("/", home)).toEqual({
      kind: "refused",
      reason: "filesystemRoot",
    });
    expect(workspaceRootEligibility("/Users", home)).toEqual({ kind: "eligible" });
    expect(workspaceRootEligibility(HOME, home)).toEqual({ kind: "eligible" });
  });

  it("compares exactly on a case-sensitive host", () => {
    const linuxHome: WorkspaceHomeReference = { path: "/home/me", pathCase: "sensitive" };

    expect(workspaceRootEligibility("/home/Me", linuxHome)).toEqual({ kind: "eligible" });
    expect(workspaceRootEligibility("/Home", linuxHome)).toEqual({ kind: "eligible" });
    expect(workspaceRootEligibility("/home/me/", linuxHome)).toEqual({
      kind: "refused",
      reason: "home",
    });
    expect(workspaceRootEligibility("/home", linuxHome)).toEqual({
      kind: "refused",
      reason: "homeAncestor",
    });
  });

  it("folds case on a case-insensitive host", () => {
    const macHome: WorkspaceHomeReference = { path: "/home/me", pathCase: "insensitive" };

    expect(workspaceRootEligibility("/home/Me", macHome)).toEqual({
      kind: "refused",
      reason: "home",
    });
    expect(workspaceRootEligibility("/Home", macHome)).toEqual({
      kind: "refused",
      reason: "homeAncestor",
    });
  });

  it("refuses the filesystem root on either host without a home", () => {
    expect(workspaceRootEligibility("C:\\", { path: null, pathCase: "sensitive" })).toEqual({
      kind: "refused",
      reason: "filesystemRoot",
    });
    expect(workspaceRootEligibility("/", UNKNOWN_WORKSPACE_HOME)).toEqual({
      kind: "refused",
      reason: "filesystemRoot",
    });
  });

  it("uses the exact refusal copy shared with the native backend", () => {
    expect(WORKSPACE_ROOT_HOME_REFUSAL).toBe("Choose a project folder, not your home folder.");
    expect(WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL).toBe(
      "Choose a project folder, not the root of the disk.",
    );
    expect(WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL).toBe(
      "Choose a project folder, not a folder that contains your home folder.",
    );
  });

  it("maps every refusal to a user-facing message", () => {
    expect(workspaceRootRefusalMessage("home")).toBe(WORKSPACE_ROOT_HOME_REFUSAL);
    expect(WORKSPACE_ROOT_HOME_REFUSAL).toBe("Choose a project folder, not your home folder.");
    expect(workspaceRootRefusalMessage("filesystemRoot")).toBe(
      WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL,
    );
    expect(workspaceRootRefusalMessage("homeAncestor")).toBe(WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL);
  });
});
