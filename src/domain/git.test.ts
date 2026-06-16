import { describe, expect, it } from "vitest";
import { emptyGitStatus, gitStatusLabel, gitStatusTitle } from "./git";

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
});
