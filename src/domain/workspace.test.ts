import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
  joinWorkspacePath,
  nextActiveEditorPathAfterClose,
  visibleEditorPaths,
  type EditorDocument,
} from "./workspace";

describe("workspace path helpers", () => {
  it("extracts file names from normalized and trailing-slash paths", () => {
    expect(getFileName("/project/src/User.php")).toBe("User.php");
    expect(getFileName("C:\\project\\src\\User.php")).toBe("User.php");
    expect(getFileName("/project/src/")).toBe("src");
  });

  it("detects language from the file name instead of dotted directories", () => {
    expect(detectLanguage("/project.v1/src/User.php")).toBe("php");
    expect(detectLanguage("/project.v1/src/README")).toBe("plaintext");
  });

  it("normalizes parent and joined paths", () => {
    expect(getParentPath("C:\\project\\src\\User.php")).toBe("C:/project/src");
    expect(joinWorkspacePath("C:\\project\\", "\\src\\User.php")).toBe(
      "C:/project/src/User.php",
    );
  });

  it("detects dirty editor documents", () => {
    const document: EditorDocument = {
      content: "changed",
      language: "php",
      name: "User.php",
      path: "/project/src/User.php",
      savedContent: "saved",
    };

    expect(isDirty(document)).toBe(true);
    expect(isDirty({ ...document, savedContent: "changed" })).toBe(false);
  });

  it("adds one preview tab after pinned editor tabs", () => {
    expect(visibleEditorPaths(["/project/A.php"], null)).toEqual([
      "/project/A.php",
    ]);
    expect(visibleEditorPaths(["/project/A.php"], "/project/B.php")).toEqual([
      "/project/A.php",
      "/project/B.php",
    ]);
    expect(visibleEditorPaths(["/project/A.php"], "/project/A.php")).toEqual([
      "/project/A.php",
    ]);
  });

  it("selects the next visible editor path after closing a tab", () => {
    expect(
      nextActiveEditorPathAfterClose(
        "/project/A.php",
        ["/project/A.php"],
        "/project/C.php",
      ),
    ).toBe("/project/C.php");
    expect(
      nextActiveEditorPathAfterClose(
        "/project/C.php",
        ["/project/A.php", "/project/B.php"],
        "/project/C.php",
      ),
    ).toBe("/project/B.php");
    expect(nextActiveEditorPathAfterClose("/project/A.php", [], null)).toBe(
      null,
    );
  });
});
