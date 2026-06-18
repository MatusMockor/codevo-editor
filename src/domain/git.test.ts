import { describe, expect, it } from "vitest";
import {
  emptyGitStatus,
  groupGitChanges,
  hasStagedGitChanges,
  gitStatusLabel,
  gitStatusTitle,
  type GitChangedFile,
} from "./git";

describe("git domain helpers", () => {
  it("creates empty status for non repository workspaces", () => {
    expect(emptyGitStatus("/workspace")).toEqual({
      branch: null,
      changes: [],
      isRepository: false,
      rootPath: "/workspace",
    });
  });

  it("formats compact status labels", () => {
    expect(gitStatusLabel("modified")).toBe("M");
    expect(gitStatusLabel("added")).toBe("A");
    expect(gitStatusLabel("deleted")).toBe("D");
    expect(gitStatusLabel("renamed")).toBe("R");
    expect(gitStatusLabel("untracked")).toBe("U");
    expect(gitStatusLabel("conflicted")).toBe("!");
    expect(gitStatusTitle("renamed")).toBe("Renamed");
  });

  it("groups tracked changes separately from unversioned files", () => {
    const modified = gitChange("modified", "src/User.php", true);
    const untracked = gitChange("untracked", "notes.txt", false);
    const groups = groupGitChanges([modified, untracked]);

    expect(groups).toEqual([
      {
        id: "changes",
        title: "Changes",
        changes: [modified],
      },
      {
        id: "unversioned",
        title: "Unversioned Files",
        changes: [untracked],
      },
    ]);
  });

  it("groups staged new files under changes", () => {
    const stagedNewFile = gitChange("added", "notes.txt", true, false);
    const groups = groupGitChanges([stagedNewFile]);

    expect(groups).toEqual([
      {
        id: "changes",
        title: "Changes",
        changes: [stagedNewFile],
      },
    ]);
  });

  it("detects when at least one change is staged", () => {
    expect(
      hasStagedGitChanges([
        gitChange("modified", "src/User.php", false),
        gitChange("added", "src/New.php", true),
      ]),
    ).toBe(true);
    expect(hasStagedGitChanges([gitChange("modified", "src/User.php", false)])).toBe(
      false,
    );
  });
});

function gitChange(
  status: GitChangedFile["status"],
  relativePath: string,
  isStaged: boolean,
  isUnversioned = status === "untracked",
): GitChangedFile {
  return {
    isStaged,
    isUnversioned,
    oldPath: null,
    oldRelativePath: null,
    path: `/workspace/${relativePath}`,
    relativePath,
    status,
  };
}
