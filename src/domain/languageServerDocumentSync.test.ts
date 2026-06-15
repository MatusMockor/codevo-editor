import { describe, expect, it } from "vitest";
import {
  createLanguageServerTextDocument,
  isLanguageServerDocument,
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

function document(language: EditorDocument["language"]): EditorDocument {
  return {
    content: "<?php echo 1;",
    language,
    name: "User.php",
    path: "/project/src/User.php",
    savedContent: "<?php echo 1;",
  };
}
