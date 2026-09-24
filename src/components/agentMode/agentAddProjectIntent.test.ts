import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL,
  WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL,
  WORKSPACE_ROOT_HOME_REFUSAL,
} from "../../domain/workspaceRootEligibility";
import {
  ADD_PROJECT_ALREADY_PROJECT_REASON,
  ADD_PROJECT_LOADING_REASON,
  ADD_PROJECT_UNREADABLE_REASON,
  agentAddProjectActionLabel,
  agentAddProjectIntent,
  agentAddProjectIntentReason,
} from "./agentAddProjectIntent";

const HOME = "/Users/dev";
const PROJECT = "/Users/dev/app";
const PROJECT_ROOT_POLICY = {
  kind: "projectRoot",
  home: { path: HOME, pathCase: "insensitive" },
} as const;

describe("agentAddProjectIntent", () => {
  it("offers to add a directory that is not a project yet", () => {
    const intent = agentAddProjectIntent({
      currentPath: PROJECT,
      hasListing: true,
      projectRootPaths: ["/Users/dev/other"],
      rootPolicy: PROJECT_ROOT_POLICY,
      status: "loaded",
    });

    expect(intent).toEqual({ kind: "add", rootPath: PROJECT });
    expect(agentAddProjectIntentReason(intent)).toBeNull();
    expect(agentAddProjectActionLabel(intent)).toBe("Add");
  });

  it("offers the existing project and keeps explaining why the action changed", () => {
    const intent = agentAddProjectIntent({
      currentPath: PROJECT,
      hasListing: true,
      projectRootPaths: ["/Users/dev/other", PROJECT],
      rootPolicy: PROJECT_ROOT_POLICY,
      status: "loaded",
    });

    expect(intent).toEqual({
      kind: "openExisting",
      rootPath: PROJECT,
      reason: ADD_PROJECT_ALREADY_PROJECT_REASON,
    });
    expect(agentAddProjectIntentReason(intent)).toBe("This directory is already a project.");
    expect(agentAddProjectActionLabel(intent)).toBe("Open project");
  });

  it("resolves the registered root rather than the browsed spelling of it", () => {
    const intent = agentAddProjectIntent({
      currentPath: `${PROJECT}/`,
      hasListing: true,
      projectRootPaths: [PROJECT],
      rootPolicy: PROJECT_ROOT_POLICY,
      status: "loaded",
    });

    expect(intent).toEqual({
      kind: "openExisting",
      rootPath: PROJECT,
      reason: ADD_PROJECT_ALREADY_PROJECT_REASON,
    });
  });

  it("blocks a listing that is still loading", () => {
    const intent = agentAddProjectIntent({
      currentPath: PROJECT,
      hasListing: true,
      projectRootPaths: [],
      rootPolicy: PROJECT_ROOT_POLICY,
      status: "loading",
    });

    expect(intent).toEqual({ kind: "blocked", reason: ADD_PROJECT_LOADING_REASON });
    expect(agentAddProjectIntentReason(intent)).toBe("Reading this directory…");
    expect(agentAddProjectActionLabel(intent)).toBe("Add");
  });

  it("blocks an unreadable, missing or pathless listing even when it is a project", () => {
    for (const input of [
      { currentPath: PROJECT, hasListing: true, status: "error" } as const,
      { currentPath: PROJECT, hasListing: false, status: "loaded" } as const,
      { currentPath: null, hasListing: true, status: "loaded" } as const,
    ]) {
      const intent = agentAddProjectIntent({
        ...input,
        projectRootPaths: [PROJECT],
        rootPolicy: PROJECT_ROOT_POLICY,
      });

      expect(intent).toEqual({ kind: "blocked", reason: ADD_PROJECT_UNREADABLE_REASON });
      expect(agentAddProjectActionLabel(intent)).toBe("Add");
    }
  });

  it.each([
    [HOME, WORKSPACE_ROOT_HOME_REFUSAL],
    [`${HOME}/`, WORKSPACE_ROOT_HOME_REFUSAL],
    ["/", WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL],
    ["/Users", WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL],
  ])("blocks %s as a project root with a clear reason", (currentPath, reason) => {
    const intent = agentAddProjectIntent({
      currentPath,
      hasListing: true,
      projectRootPaths: [],
      rootPolicy: PROJECT_ROOT_POLICY,
      status: "loaded",
    });

    expect(intent).toEqual({ kind: "blocked", reason });
    expect(agentAddProjectIntentReason(intent)).toBe(reason);
    expect(agentAddProjectActionLabel(intent)).toBe("Add");
  });

  it("blocks home even when it was already registered as a project", () => {
    const intent = agentAddProjectIntent({
      currentPath: HOME,
      hasListing: true,
      projectRootPaths: [HOME],
      rootPolicy: PROJECT_ROOT_POLICY,
      status: "loaded",
    });

    expect(intent).toEqual({ kind: "blocked", reason: WORKSPACE_ROOT_HOME_REFUSAL });
  });

  it("refuses the filesystem root even before the home folder is known", () => {
    const intent = agentAddProjectIntent({
      currentPath: "/",
      hasListing: true,
      projectRootPaths: [],
      rootPolicy: { kind: "projectRoot", home: { path: null, pathCase: "insensitive" } },
      status: "loaded",
    });

    expect(intent).toEqual({ kind: "blocked", reason: WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL });
  });

  it("allows home as a plain directory choice outside the project root policy", () => {
    const intent = agentAddProjectIntent({
      currentPath: HOME,
      hasListing: true,
      projectRootPaths: [],
      rootPolicy: { kind: "anyDirectory" },
      status: "loaded",
    });

    expect(intent).toEqual({ kind: "add", rootPath: HOME });
  });
});
