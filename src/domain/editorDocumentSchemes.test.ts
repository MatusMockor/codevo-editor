import { describe, expect, it } from "vitest";
import {
  buildGitDiffDocumentPath,
  buildGitHistoryDiffDocumentPath,
  buildMarkdownPreviewDocumentPath,
  isGitDiffDocumentPath,
  isGitHistoryDiffDocumentPath,
  isMarkdownPreviewDocumentPath,
  isPersistableEditorDocumentPath,
  transientEditorDocumentSchemes,
} from "./editorDocumentSchemes";

describe("transientEditorDocumentSchemes", () => {
  it("declares every transient scheme as non-persistable", () => {
    expect(transientEditorDocumentSchemes.map((scheme) => scheme.prefix)).toEqual([
      "mockor-git-diff:",
      "mockor-git-history-diff:",
      "mockor-markdown-preview:",
    ]);
    expect(
      transientEditorDocumentSchemes.every((scheme) => !scheme.persistable),
    ).toBe(true);
  });
});

describe("builders", () => {
  it("builds worktree git diff document paths", () => {
    expect(buildGitDiffDocumentPath("worktree", "/workspace/src/User.php")).toBe(
      "mockor-git-diff:worktree:/workspace/src/User.php",
    );
  });

  it("builds staged git diff document paths", () => {
    expect(buildGitDiffDocumentPath("staged", "/workspace/src/User.php")).toBe(
      "mockor-git-diff:staged:/workspace/src/User.php",
    );
  });

  it("builds git history diff document paths", () => {
    expect(
      buildGitHistoryDiffDocumentPath("abc123", "src/User.php", null),
    ).toBe("mockor-git-history-diff:abc123:src/User.php");
  });

  it("builds git history diff document paths for renames", () => {
    expect(
      buildGitHistoryDiffDocumentPath("abc123", "src/New.php", "src/Old.php"),
    ).toBe("mockor-git-history-diff:abc123:src/Old.php->src/New.php");
  });

  it("collapses git history rename suffix when old path equals path", () => {
    expect(
      buildGitHistoryDiffDocumentPath("abc123", "src/User.php", "src/User.php"),
    ).toBe("mockor-git-history-diff:abc123:src/User.php");
  });

  it("builds markdown preview document paths", () => {
    expect(buildMarkdownPreviewDocumentPath("/workspace/README.md")).toBe(
      "mockor-markdown-preview:/workspace/README.md",
    );
  });
});

describe("checkers", () => {
  it("matches git diff paths by prefix", () => {
    expect(
      isGitDiffDocumentPath("mockor-git-diff:worktree:/workspace/A.php"),
    ).toBe(true);
    expect(isGitDiffDocumentPath("mockor-git-diff:")).toBe(true);
    expect(isGitDiffDocumentPath("mockor-git-diff")).toBe(false);
    expect(
      isGitDiffDocumentPath("mockor-git-history-diff:abc:/workspace/A.php"),
    ).toBe(false);
    expect(isGitDiffDocumentPath("/workspace/A.php")).toBe(false);
  });

  it("matches git history diff paths by prefix", () => {
    expect(
      isGitHistoryDiffDocumentPath("mockor-git-history-diff:abc:src/A.php"),
    ).toBe(true);
    expect(isGitHistoryDiffDocumentPath("mockor-git-history-diff:")).toBe(true);
    expect(
      isGitHistoryDiffDocumentPath("mockor-git-diff:worktree:/workspace/A.php"),
    ).toBe(false);
    expect(isGitHistoryDiffDocumentPath("/workspace/A.php")).toBe(false);
  });

  it("matches markdown preview paths by prefix", () => {
    expect(
      isMarkdownPreviewDocumentPath("mockor-markdown-preview:/README.md"),
    ).toBe(true);
    expect(isMarkdownPreviewDocumentPath("mockor-markdown-preview:")).toBe(true);
    expect(isMarkdownPreviewDocumentPath("/workspace/README.md")).toBe(false);
  });
});

describe("isPersistableEditorDocumentPath", () => {
  it("treats plain file paths as persistable", () => {
    expect(isPersistableEditorDocumentPath("/workspace/src/A.php")).toBe(true);
    expect(isPersistableEditorDocumentPath("src/relative.ts")).toBe(true);
    expect(isPersistableEditorDocumentPath("")).toBe(true);
  });

  it("treats every transient scheme path as non-persistable", () => {
    expect(
      isPersistableEditorDocumentPath(
        buildGitDiffDocumentPath("worktree", "/workspace/A.php"),
      ),
    ).toBe(false);
    expect(
      isPersistableEditorDocumentPath(
        buildGitHistoryDiffDocumentPath("abc123", "src/A.php", null),
      ),
    ).toBe(false);
    expect(
      isPersistableEditorDocumentPath(
        buildMarkdownPreviewDocumentPath("/workspace/README.md"),
      ),
    ).toBe(false);
  });

  it("treats paths that merely contain a scheme mid-string as persistable", () => {
    expect(
      isPersistableEditorDocumentPath("/workspace/mockor-git-diff:notes.txt"),
    ).toBe(true);
  });
});
