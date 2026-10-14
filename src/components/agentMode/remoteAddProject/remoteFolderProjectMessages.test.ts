import { describe, expect, it } from "vitest";
import {
  INITIAL_REMOTE_ADD_PROJECT_FOLDER,
  reduceRemoteAddProjectFolder,
  type RemoteAddProjectFolderAction,
  type RemoteAddProjectFolderFailure,
  type RemoteAddProjectFolderState,
  type RemoteFolderProjectSupport,
} from "../../../application/remoteAddProjectFolder";
import type { RemoteProjectRegistrationRejection } from "../../../domain/remoteProjectRegistration";
import {
  REMOTE_FOLDER_PROJECT_HINT,
  REMOTE_FOLDER_PROJECT_TITLE,
  remoteFolderProjectHint,
  remoteFolderProjectMessage,
  remoteFolderProjectNameMessage,
  remoteFolderProjectPrimaryLabel,
} from "./remoteFolderProjectMessages";

const PATH = "/srv/repos/billing";
const SUPPORTS = ["unknown", "supported", "unsupported"] as const;
const OLD_NOT_GIT_ROOT =
  "This folder is not the root of a Git repository. Choose the repository's top-level folder.";
const NESTED_NOT_GIT_ROOT =
  "This folder is inside a Git repository. Choose the repository's top-level folder.";
const NAME_RULE =
  "Use letters or digits first, then letters, digits, hyphen or underscore, up to 64 characters.";
const NAME_TAKEN = "A project with this name already exists on this server.";

function run(...actions: RemoteAddProjectFolderAction[]): RemoteAddProjectFolderState {
  return actions.reduce(reduceRemoteAddProjectFolder, INITIAL_REMOTE_ADD_PROJECT_FOLDER);
}

function described(support: RemoteFolderProjectSupport): RemoteAddProjectFolderAction[] {
  if (support === "unknown") return [];
  return [{ kind: "runnerDescribed", folderProjects: support }];
}

function ready(support: RemoteFolderProjectSupport): RemoteAddProjectFolderState {
  return run(...described(support), { kind: "chooseFolder", path: PATH });
}

function submitting(support: RemoteFolderProjectSupport): RemoteAddProjectFolderState {
  return reduceRemoteAddProjectFolder(ready(support), { kind: "submitStarted", submission: 1 });
}

function rejected(
  support: RemoteFolderProjectSupport,
  reason: RemoteProjectRegistrationRejection,
): RemoteAddProjectFolderState {
  return reduceRemoteAddProjectFolder(submitting(support), {
    kind: "submitRejected",
    submission: 1,
    reason,
  });
}

function failed(
  support: RemoteFolderProjectSupport,
  failure: RemoteAddProjectFolderFailure,
): RemoteAddProjectFolderState {
  return reduceRemoteAddProjectFolder(submitting(support), {
    kind: "submitFailed",
    submission: 1,
    failure,
  });
}

describe("remoteFolderProjectMessages", () => {
  it("names the source", () => {
    expect(REMOTE_FOLDER_PROJECT_TITLE).toBe("Existing folder on server");
  });

  describe("folder project hint", () => {
    it("is conditional and names what a folder project cannot do", () => {
      expect(REMOTE_FOLDER_PROJECT_HINT).toBe(
        "If this folder is not a Git repository, threads run directly in it, without worktrees, branches, diffs, commit or push.",
      );
    });

    it("shows at every step of the form when the runner supports folder projects", () => {
      const invalid = reduceRemoteAddProjectFolder(ready("supported"), {
        kind: "setName",
        value: "-x",
      });
      for (const folder of [
        ready("supported"),
        invalid,
        submitting("supported"),
        rejected("supported", "not_git_root"),
        rejected("supported", "name_taken"),
        failed("supported", { kind: "unknown" }),
      ]) {
        expect(remoteFolderProjectHint(folder), folder.phase).toBe(REMOTE_FOLDER_PROJECT_HINT);
      }
    });

    it.each(["unknown", "unsupported"] as const)(
      "stays hidden while the runner's support is %s",
      (support) => {
        for (const folder of [
          ready(support),
          submitting(support),
          rejected(support, "not_git_root"),
          failed(support, { kind: "runnerOutdated" }),
        ]) {
          expect(remoteFolderProjectHint(folder), folder.phase).toBeNull();
        }
      },
    );

    it.each(SUPPORTS)("stays hidden in the folder browser when support is %s", (support) => {
      const browsing = run(...described(support));
      expect(browsing.phase).toBe("browsing");
      expect(remoteFolderProjectHint(browsing)).toBeNull();
      const returned = reduceRemoteAddProjectFolder(ready(support), { kind: "back" });
      expect(returned.phase).toBe("browsing");
      expect(remoteFolderProjectHint(returned)).toBeNull();
    });
  });

  describe("not_git_root", () => {
    it("says the folder is inside a repository when plain folders are accepted", () => {
      expect(remoteFolderProjectMessage(rejected("supported", "not_git_root"))).toBe(
        NESTED_NOT_GIT_ROOT,
      );
    });

    it.each(["unsupported", "unknown"] as const)(
      "keeps the original copy when the runner's support is %s",
      (support) => {
        expect(remoteFolderProjectMessage(rejected(support, "not_git_root"))).toBe(
          OLD_NOT_GIT_ROOT,
        );
      },
    );
  });

  it.each(SUPPORTS)("explains the other rejections the same way when support is %s", (support) => {
    expect(remoteFolderProjectMessage(rejected(support, "limit_reached"))).toBe(
      "This server already has the maximum number of projects.",
    );
    expect(remoteFolderProjectMessage(rejected(support, "not_allowed"))).toBe(
      "This folder cannot be added as a project.",
    );
    expect(remoteFolderProjectMessage(rejected(support, "name_taken"))).toBeNull();
    expect(remoteFolderProjectNameMessage(rejected(support, "name_taken"))).toBe(NAME_TAKEN);
    expect(remoteFolderProjectNameMessage(rejected(support, "not_git_root"))).toBeNull();
  });

  it.each(SUPPORTS)("explains every failure the same way when support is %s", (support) => {
    expect(remoteFolderProjectMessage(failed(support, { kind: "runnerOutdated" }))).toBe(
      "This server's runner does not support adding existing folders yet. Update the runner.",
    );
    expect(remoteFolderProjectMessage(failed(support, { kind: "runnerUnreachable" }))).toBe(
      "Could not reach this server's runner. Try again.",
    );
    expect(remoteFolderProjectMessage(failed(support, { kind: "projectMissing" }))).toBe(
      "The folder was added, but the project is not in this server's list yet. Close this dialog and open it from the server projects.",
    );
    expect(remoteFolderProjectMessage(failed(support, { kind: "unknown" }))).toBe(
      "Could not add this folder. Try again.",
    );
  });

  it("stays silent until something was rejected or failed", () => {
    for (const support of SUPPORTS) {
      expect(remoteFolderProjectMessage(run(...described(support)))).toBeNull();
      expect(remoteFolderProjectMessage(ready(support))).toBeNull();
      expect(remoteFolderProjectMessage(submitting(support))).toBeNull();
      expect(remoteFolderProjectNameMessage(ready(support))).toBeNull();
    }
  });

  it("asks for a valid name while the name is not usable", () => {
    const naming = reduceRemoteAddProjectFolder(ready("supported"), {
      kind: "setName",
      value: "my.project",
    });
    expect(remoteFolderProjectNameMessage(naming)).toBe(NAME_RULE);
    expect(remoteFolderProjectMessage(naming)).toBeNull();
  });

  it("labels the primary action by whether a submission is in flight", () => {
    expect(remoteFolderProjectPrimaryLabel(ready("supported"))).toBe("Add project");
    expect(remoteFolderProjectPrimaryLabel(submitting("supported"))).toBe("Adding project…");
    expect(remoteFolderProjectPrimaryLabel(rejected("unsupported", "not_allowed"))).toBe(
      "Add project",
    );
  });
});
