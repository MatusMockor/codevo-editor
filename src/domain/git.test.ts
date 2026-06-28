import { describe, expect, it } from "vitest";
import {
  emptyGitStatus,
  gitBlameAnnotation,
  gitBlameRelativeDate,
  groupGitChanges,
  hasStagedGitChanges,
  gitStatusLabel,
  gitStatusTitle,
  type GitBlameLine,
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

  it("formats relative blame dates", () => {
    const now = new Date("2026-06-25T12:00:00Z").getTime();
    const seconds = (value: number) => Math.floor(now / 1000) - value;

    expect(gitBlameRelativeDate(seconds(30), now)).toBe("just now");
    expect(gitBlameRelativeDate(seconds(120), now)).toBe("2 minutes ago");
    expect(gitBlameRelativeDate(seconds(3 * 3600), now)).toBe("3 hours ago");
    expect(gitBlameRelativeDate(seconds(2 * 86400), now)).toBe("2 days ago");
    expect(gitBlameRelativeDate(seconds(21 * 86400), now)).toBe("3 weeks ago");
    expect(gitBlameRelativeDate(seconds(60 * 86400), now)).toBe("2 months ago");
    expect(gitBlameRelativeDate(seconds(800 * 86400), now)).toBe("2 years ago");
  });

  it("builds a gutter annotation with author and relative date", () => {
    const now = new Date("2026-06-25T12:00:00Z").getTime();
    const line: GitBlameLine = {
      author: "Alice Example",
      lineNumber: 1,
      sha: "1a2b3c4",
      timestamp: Math.floor(now / 1000) - 2 * 86400,
    };

    expect(gitBlameAnnotation(line, now)).toBe("Alice Example, 2 days ago");
  });

  it("renders uncommitted blame lines compactly", () => {
    const now = new Date("2026-06-25T12:00:00Z").getTime();
    const line: GitBlameLine = {
      author: "Not Committed Yet",
      lineNumber: 1,
      sha: "0000000",
      timestamp: 0,
    };

    expect(gitBlameAnnotation(line, now)).toBe("Not Committed Yet");
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
