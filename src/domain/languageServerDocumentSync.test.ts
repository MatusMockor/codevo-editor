import { describe, expect, it } from "vitest";
import {
  createLanguageServerTextDocument,
  fileUriFromPath,
  isLanguageServerDocument,
  languageServerLanguageIdForDocument,
} from "./languageServerDocumentSync";
import type { EditorDocument } from "./workspace";

describe("isLanguageServerDocument", () => {
  it("syncs PHP documents only", () => {
    expect(isLanguageServerDocument(document("php"))).toBe(true);
    expect(isLanguageServerDocument(document("typescript"))).toBe(false);
  });
});

describe("createLanguageServerTextDocument", () => {
  it("maps an editor document to LSP text document content", () => {
    expect(createLanguageServerTextDocument(document("php"), 4)).toEqual({
      languageId: "php",
      path: "/project/src/User.php",
      text: "<?php echo 1;",
      version: 4,
    });
  });
});

describe("languageServerLanguageIdForDocument", () => {
  it("uses VS Code language ids for JavaScript and TypeScript React files", () => {
    expect(
      languageServerLanguageIdForDocument(
        document("javascript", "/project/src/App.jsx"),
      ),
    ).toBe("javascriptreact");
    expect(
      languageServerLanguageIdForDocument(
        document("typescript", "/project/src/App.tsx"),
      ),
    ).toBe("typescriptreact");
  });

  it("keeps non-React language ids unchanged", () => {
    expect(
      languageServerLanguageIdForDocument(
        document("typescript", "/project/src/app.ts"),
      ),
    ).toBe("typescript");
    expect(
      languageServerLanguageIdForDocument(
        document("javascript", "/project/src/app.mjs"),
      ),
    ).toBe("javascript");
  });
});

describe("fileUriFromPath", () => {
  it("encodes local paths as file uris", () => {
    expect(fileUriFromPath("/project/src/User Name.php")).toBe(
      "file:///project/src/User%20Name.php",
    );
    expect(fileUriFromPath("C:\\project\\src\\User.php")).toBe(
      "file:///C:/project/src/User.php",
    );
  });
});

function document(
  language: EditorDocument["language"],
  path = "/project/src/User.php",
): EditorDocument {
  return {
    content: "<?php echo 1;",
    language,
    name: path.split("/").pop() ?? "User.php",
    path,
    savedContent: "<?php echo 1;",
  };
}
