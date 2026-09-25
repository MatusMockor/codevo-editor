import { describe, expect, it } from "vitest";
import { evaluateCloneForm, type CloneFormContext, type CloneFormInput } from "./cloneForm";
import {
  WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL,
  WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL,
  WORKSPACE_ROOT_HOME_REFUSAL,
} from "./workspaceRootEligibility";

const context: CloneFormContext = {
  home: "/Users/dev",
  shorthandHost: "github.com",
  lastParent: null,
  probe: { kind: "free" },
};
const input: CloneFormInput = {
  url: "https://github.com/acme/web-dashboard",
  destination: "",
  destinationEdited: false,
  branch: "",
  urlTouched: false,
};

describe("evaluateCloneForm", () => {
  it("fills ~/code/<name>, marks ~/code for creation and builds the request", () => {
    const state = evaluateCloneForm(input, context);
    expect(state.repository).toEqual({
      kind: "ok",
      title: "acme/web-dashboard",
      detail: "github.com · HTTPS",
      glyph: "github",
    });
    expect(state.destination).toBe("~/code/web-dashboard");
    expect(state.destinationError).toBeNull();
    expect(state.request).toEqual({
      url: "https://github.com/acme/web-dashboard",
      name: "web-dashboard",
      parentPath: "/Users/dev/code",
      ensureParent: true,
    });
    expect(state.source).toEqual({ host: "github.com", path: "acme/web-dashboard" });
  });

  it("uses the remembered parent without ensureParent", () => {
    const state = evaluateCloneForm(input, { ...context, lastParent: "/Users/dev/src" });
    expect(state.destination).toBe("~/src/web-dashboard");
    expect(state.request).toEqual({
      url: "https://github.com/acme/web-dashboard",
      name: "web-dashboard",
      parentPath: "/Users/dev/src",
    });
  });

  it("keeps an edited destination and includes a valid branch", () => {
    const state = evaluateCloneForm(
      {
        ...input,
        destination: "/opt/work/dash",
        destinationEdited: true,
        branch: "release/2026.04",
      },
      context,
    );
    expect(state.request).toEqual({
      url: "https://github.com/acme/web-dashboard",
      name: "dash",
      parentPath: "/opt/work",
      branch: "release/2026.04",
    });
  });

  it("never enables Clone for credential URLs", () => {
    for (const url of [
      "https://tok@github.com/acme/x.git",
      "https://ghp_x@github.com/a/b.git",
      "https://user:pw@host/a/b",
    ]) {
      const state = evaluateCloneForm({ ...input, url }, context);
      expect(state.repository).toEqual({
        kind: "bad",
        title: "A URL carrying credentials is rejected",
        detail: "Remove the token and sign in with gh auth login instead.",
      });
      expect(state.request).toBeNull();
      expect(state.source).toBeNull();
      expect(state.destination).toBe("");
      expect(state.destinationTarget).toBeNull();
      expect(JSON.stringify(state)).not.toContain("ghp_x");
      expect(JSON.stringify(state)).not.toContain("pw@");
    }
    const edited = evaluateCloneForm(
      {
        ...input,
        url: "https://ghp_x@github.com/a/b.git",
        destination: "~/code/b",
        destinationEdited: true,
      },
      context,
    );
    expect(edited.request).toBeNull();
  });

  it("shows invalid input as an error only after the field was touched", () => {
    expect(evaluateCloneForm({ ...input, url: "nope" }, context).repository.kind).toBe("empty");
    expect(
      evaluateCloneForm({ ...input, url: "nope", urlTouched: true }, context).repository,
    ).toEqual({
      kind: "bad",
      title: "That is not a clone URL Codevo accepts",
      detail: "Use https://host/owner/repo.git or git@host:owner/repo.git",
    });
  });

  it("flags existing folder and existing project", () => {
    const exists = evaluateCloneForm(input, { ...context, probe: { kind: "exists" } });
    expect(exists.destinationError).toBe(
      "~/code/web-dashboard already exists. Choose another folder name.",
    );
    expect(exists.request).toBeNull();
    const project = evaluateCloneForm(input, {
      ...context,
      probe: { kind: "project", rootPath: "/Users/dev/code/web-dashboard" },
    });
    expect(project.destinationError).toBe("~/code/web-dashboard is already a project.");
    expect(project.existingProjectRoot).toBe("/Users/dev/code/web-dashboard");
    expect(project.request).toBeNull();
  });

  it("rejects bad destinations and branches without blocking on an unknown probe", () => {
    const badDestination = evaluateCloneForm(
      { ...input, destination: "code/app", destinationEdited: true },
      { ...context, probe: { kind: "unknown" } },
    );
    expect(badDestination.destinationError).toBe(
      "Enter an absolute destination path with a valid folder name.",
    );
    const badBranch = evaluateCloneForm({ ...input, branch: "-bad..x" }, context);
    expect(badBranch.branchError).toBe("Not a valid branch name.");
    expect(badBranch.request).toBeNull();
    expect(
      evaluateCloneForm(input, { ...context, probe: { kind: "unknown" } }).request,
    ).not.toBeNull();
  });

  it("keeps Clone disabled while the destination is still being checked", () => {
    const checking = evaluateCloneForm(input, { ...context, probe: { kind: "checking" } });
    expect(checking.request).toBeNull();
    expect(checking.destinationError).toBeNull();
    expect(checking.destinationTarget).not.toBeNull();
  });

  it.each([
    ["the home folder as ~", "~", WORKSPACE_ROOT_HOME_REFUSAL],
    ["the home folder as an absolute path", "/Users/dev/", WORKSPACE_ROOT_HOME_REFUSAL],
    ["the disk root", "/", WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL],
    ["an ancestor of home", "/Users", WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL],
    ["an ancestor of home in another case", "/users", WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL],
  ])("refuses %s as the destination", (_label, destination, message) => {
    const state = evaluateCloneForm(
      { ...input, destination, destinationEdited: true },
      { ...context, probe: { kind: "free" } },
    );
    expect(state.destinationError).toBe(message);
    expect(state.destinationTarget).toBeNull();
    expect(state.existingProjectRoot).toBeNull();
    expect(state.request).toBeNull();
  });

  it("honours a case-sensitive home when refusing ancestors", () => {
    const sensitive = { ...context, homePathCase: "sensitive" as const };
    expect(
      evaluateCloneForm({ ...input, destination: "/users", destinationEdited: true }, sensitive)
        .destinationError,
    ).toBeNull();
    expect(
      evaluateCloneForm({ ...input, destination: "/Users", destinationEdited: true }, sensitive)
        .destinationError,
    ).toBe(WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL);
  });

  it("requires an absolute path when the home folder is unknown", () => {
    const state = evaluateCloneForm(input, { ...context, home: null });
    expect(state.destination).toBe("");
    expect(state.request).toBeNull();
  });

  it("labels SSH, GitLab and other hosts", () => {
    expect(
      evaluateCloneForm({ ...input, url: "git@gitlab.com:g/p.git" }, context).repository,
    ).toMatchObject({ detail: "gitlab.com · SSH", glyph: "gitlab" });
    expect(evaluateCloneForm({ ...input, url: "acme/web" }, context).repository).toMatchObject({
      detail: "github.com · GitHub shorthand",
      glyph: "github",
    });
    expect(
      evaluateCloneForm({ ...input, url: "https://git.example.com/a/b" }, context).repository,
    ).toMatchObject({ glyph: "gitUrl" });
  });
});
