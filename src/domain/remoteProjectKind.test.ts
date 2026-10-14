import { describe, expect, it } from "vitest";
import {
  isRemoteFolderProject,
  isRemoteProjectKind,
  REMOTE_PROJECT_KINDS,
  remoteProjectKindOf,
} from "./remoteProjectKind";
import { isRemoteProjectRegistration } from "./remoteProjectRegistration";
import { validateRemoteRunnerValue } from "./remoteRunnerValidation";

const INVALID_LIST = "Invalid remote runner listProjects response.";
const CLONE_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("remote project kind", () => {
  it("is the closed repository and folder set", () => {
    expect(REMOTE_PROJECT_KINDS).toEqual(["repository", "folder"]);
  });

  it.each(REMOTE_PROJECT_KINDS)("accepts %s", (kind) => {
    expect(isRemoteProjectKind(kind)).toBe(true);
  });

  it.each(["", "Folder", "FOLDER", " folder", "folder ", "repo", "directory", "worktree", "git"])(
    "rejects the unknown kind %j",
    (kind) => {
      expect(isRemoteProjectKind(kind)).toBe(false);
    },
  );

  it.each([undefined, null, 0, 1, true, false, {}, [], ["folder"], { kind: "folder" }])(
    "rejects the non-string value %j",
    (kind) => {
      expect(isRemoteProjectKind(kind)).toBe(false);
    },
  );

  it("treats an absent kind as a repository", () => {
    expect(remoteProjectKindOf({})).toBe("repository");
    expect(remoteProjectKindOf({ kind: undefined })).toBe("repository");
    expect(isRemoteFolderProject({})).toBe(false);
  });

  it("keeps an explicit kind", () => {
    expect(remoteProjectKindOf({ kind: "repository" })).toBe("repository");
    expect(remoteProjectKindOf({ kind: "folder" })).toBe("folder");
    expect(isRemoteFolderProject({ kind: "repository" })).toBe(false);
    expect(isRemoteFolderProject({ kind: "folder" })).toBe(true);
  });
});

describe("remote project kind on the project list", () => {
  const list = (item: unknown) => () =>
    validateRemoteRunnerValue("listProjects", "response", { items: [item] });

  it("accepts an older runner item without a kind", () => {
    expect(list({ id: "billing", name: "Billing" })).not.toThrow();
  });

  it.each(REMOTE_PROJECT_KINDS)("accepts an item of kind %s", (kind) => {
    expect(list({ id: "billing", name: "Billing", kind })).not.toThrow();
  });

  it("accepts repositories and folders in one list", () => {
    expect(() =>
      validateRemoteRunnerValue("listProjects", "response", {
        items: [
          { id: "billing", name: "Billing" },
          { id: "editor", name: "Editor", kind: "repository" },
          { id: "notes", name: "Notes", kind: "folder" },
        ],
      }),
    ).not.toThrow();
  });

  it.each([null, "", "Folder", "directory", 1, true, {}, ["folder"]])(
    "rejects the unknown kind %j",
    (kind) => {
      expect(list({ id: "billing", name: "Billing", kind })).toThrow(INVALID_LIST);
    },
  );

  it.each([
    { id: "billing", name: "Billing", kind: "folder", path: "/srv/billing" },
    { id: "billing", name: "Billing", type: "folder" },
    { id: "billing", name: "Billing", git: false },
  ])("rejects the extra key in %j", (item) => {
    expect(list(item)).toThrow(INVALID_LIST);
  });

  it.each([
    { id: "billing", kind: "folder" },
    { name: "Billing", kind: "folder" },
    { kind: "folder" },
  ])("still requires the identity in %j", (item) => {
    expect(list(item)).toThrow(INVALID_LIST);
  });
});

describe("remote project kind outside the project list", () => {
  const succeeded = (project: unknown) => ({
    id: CLONE_ID,
    status: "succeeded",
    project,
    error: null,
  });

  it("accepts a clone job project without a kind", () => {
    expect(() =>
      validateRemoteRunnerValue(
        "getProjectClone",
        "response",
        succeeded({ id: "billing", name: "Billing" }),
      ),
    ).not.toThrow();
  });

  it.each(["cloneProject", "getProjectClone", "cancelProjectClone"] as const)(
    "rejects a kind on the %s job project",
    (operation) => {
      for (const kind of REMOTE_PROJECT_KINDS) {
        expect(() =>
          validateRemoteRunnerValue(
            operation,
            "response",
            succeeded({ id: "billing", name: "Billing", kind }),
          ),
        ).toThrow(`Invalid remote runner ${operation} response.`);
      }
    },
  );

  it.each(REMOTE_PROJECT_KINDS)("rejects kind %s on a registered project", (kind) => {
    const registration = (project: unknown) => ({ status: "registered", project, created: true });
    expect(isRemoteProjectRegistration(registration({ id: "billing", name: "Billing" }))).toBe(
      true,
    );
    expect(
      isRemoteProjectRegistration(registration({ id: "billing", name: "Billing", kind })),
    ).toBe(false);
  });
});
