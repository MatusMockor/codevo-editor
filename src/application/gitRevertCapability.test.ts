import { describe, expect, it } from "vitest";
import type { GitChangedFile } from "../domain/git";
import type { EditorDocument } from "../domain/workspace";
import { canRevertGitChangeForDocuments } from "./gitRevertCapability";

const change: GitChangedFile = {
  isStaged: false,
  isUnversioned: false,
  oldPath: null,
  oldRelativePath: null,
  path: "/workspace/src/example.ts",
  relativePath: "src/example.ts",
  status: "modified",
};

function document(
  content: string,
  savedContent: string,
  path = change.path,
): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "example.ts",
    path,
    savedContent,
  };
}

describe("canRevertGitChangeForDocuments", () => {
  it("blocks revert for the corresponding dirty editor document", () => {
    expect(
      canRevertGitChangeForDocuments(change, {
        [change.path]: document("unsaved", "saved"),
      }),
    ).toBe(false);
  });

  it("allows revert for saved or unopened documents", () => {
    expect(
      canRevertGitChangeForDocuments(change, {
        [change.path]: document("saved", "saved"),
      }),
    ).toBe(true);
    expect(canRevertGitChangeForDocuments(change, {})).toBe(true);
  });

  it("matches an open document through normalized path identity", () => {
    expect(
      canRevertGitChangeForDocuments(change, {
        alias: document("unsaved", "saved", `${change.path}/`),
      }),
    ).toBe(false);
  });
});
