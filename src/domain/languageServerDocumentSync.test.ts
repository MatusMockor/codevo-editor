import { describe, expect, it } from "vitest";
import {
  createLanguageServerTextDocument,
  fileUriFromPath,
  isLanguageServerDocument,
  languageServerDocumentSyncKey,
  languageServerLanguageIdForDocument,
  languageServerPathFromDocumentSyncKey,
  languageServerUriSyncKey,
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

describe("workspace-scoped sync keys", () => {
  it("separates the same document path by workspace root", () => {
    const documentKey = languageServerDocumentSyncKey(
      "/workspace-a/",
      "/workspace-a/src/App.ts",
    );

    expect(documentKey).not.toBe(
      languageServerDocumentSyncKey(
        "/workspace-b/",
        "/workspace-a/src/App.ts",
      ),
    );
    expect(
      languageServerPathFromDocumentSyncKey("/workspace-a", documentKey),
    ).toBe("/workspace-a/src/App.ts");
    expect(
      languageServerPathFromDocumentSyncKey("/workspace-b", documentKey),
    ).toBeNull();
  });

  it("separates document versions by workspace root and uri", () => {
    const uri = fileUriFromPath("/workspace-a/src/App.ts");

    expect(languageServerUriSyncKey("/workspace-a", uri)).not.toBe(
      languageServerUriSyncKey("/workspace-b", uri),
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
