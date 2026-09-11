import { describe, expect, it } from "vitest";
import {
  ADD_PROJECT_ALREADY_PROJECT_REASON,
  ADD_PROJECT_LOADING_REASON,
  ADD_PROJECT_UNREADABLE_REASON,
  agentAddProjectActionLabel,
  agentAddProjectIntent,
  agentAddProjectIntentReason,
} from "./agentAddProjectIntent";

const HOME = "/Users/dev";

describe("agentAddProjectIntent", () => {
  it("offers to add a directory that is not a project yet", () => {
    const intent = agentAddProjectIntent({
      currentPath: HOME,
      hasListing: true,
      projectRootPaths: ["/Users/dev/other"],
      status: "loaded",
    });

    expect(intent).toEqual({ kind: "add", rootPath: HOME });
    expect(agentAddProjectIntentReason(intent)).toBeNull();
    expect(agentAddProjectActionLabel(intent)).toBe("Add");
  });

  it("offers the existing project and keeps explaining why the action changed", () => {
    const intent = agentAddProjectIntent({
      currentPath: HOME,
      hasListing: true,
      projectRootPaths: ["/Users/dev/other", HOME],
      status: "loaded",
    });

    expect(intent).toEqual({
      kind: "openExisting",
      rootPath: HOME,
      reason: ADD_PROJECT_ALREADY_PROJECT_REASON,
    });
    expect(agentAddProjectIntentReason(intent)).toBe("This directory is already a project.");
    expect(agentAddProjectActionLabel(intent)).toBe("Open project");
  });

  it("resolves the registered root rather than the browsed spelling of it", () => {
    const intent = agentAddProjectIntent({
      currentPath: `${HOME}/`,
      hasListing: true,
      projectRootPaths: [HOME],
      status: "loaded",
    });

    expect(intent).toEqual({
      kind: "openExisting",
      rootPath: HOME,
      reason: ADD_PROJECT_ALREADY_PROJECT_REASON,
    });
  });

  it("blocks a listing that is still loading", () => {
    const intent = agentAddProjectIntent({
      currentPath: HOME,
      hasListing: true,
      projectRootPaths: [],
      status: "loading",
    });

    expect(intent).toEqual({ kind: "blocked", reason: ADD_PROJECT_LOADING_REASON });
    expect(agentAddProjectIntentReason(intent)).toBe("Reading this directory…");
    expect(agentAddProjectActionLabel(intent)).toBe("Add");
  });

  it("blocks an unreadable, missing or pathless listing even when it is a project", () => {
    for (const input of [
      { currentPath: HOME, hasListing: true, status: "error" } as const,
      { currentPath: HOME, hasListing: false, status: "loaded" } as const,
      { currentPath: null, hasListing: true, status: "loaded" } as const,
    ]) {
      const intent = agentAddProjectIntent({ ...input, projectRootPaths: [HOME] });

      expect(intent).toEqual({ kind: "blocked", reason: ADD_PROJECT_UNREADABLE_REASON });
      expect(agentAddProjectActionLabel(intent)).toBe("Add");
    }
  });
});
