import { describe, expect, it } from "vitest";
import {
  createLanguageServerTextDocument,
  fileUriFromPath,
  fileUriFromWorkspacePath,
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
  languageServerDocumentSyncKey,
  languageServerLanguageIdForDocument,
  languageServerPathFromDocumentSyncKey,
  languageServerUriSyncKey,
  tryLanguageServerUriSyncKey,
} from "./languageServerDocumentSync";
import type { EditorDocument } from "./workspace";
import { createWorkspaceRootFromPath } from "./workspacePath";

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

  it("syncs Vue single file components with the vue language id", () => {
    const vueDocument = document("vue", "/project/src/App.vue");

    expect(createLanguageServerTextDocument(vueDocument, 7)).toEqual({
      languageId: "vue",
      path: "/project/src/App.vue",
      text: "<?php echo 1;",
      version: 7,
    });
  });
});

describe("isJavaScriptTypeScriptLanguageServerDocument", () => {
  it("routes JavaScript, TypeScript, React and Vue documents through the JS/TS server", () => {
    expect(
      isJavaScriptTypeScriptLanguageServerDocument(document("javascript")),
    ).toBe(true);
    expect(
      isJavaScriptTypeScriptLanguageServerDocument(document("typescript")),
    ).toBe(true);
    expect(
      isJavaScriptTypeScriptLanguageServerDocument(
        document("javascript", "/project/src/App.jsx"),
      ),
    ).toBe(true);
    expect(
      isJavaScriptTypeScriptLanguageServerDocument(
        document("typescript", "/project/src/App.tsx"),
      ),
    ).toBe(true);
    expect(
      isJavaScriptTypeScriptLanguageServerDocument(
        document("javascriptreact", "/project/src/App.jsx"),
      ),
    ).toBe(true);
    expect(
      isJavaScriptTypeScriptLanguageServerDocument(
        document("typescriptreact", "/project/src/App.tsx"),
      ),
    ).toBe(true);
    expect(
      isJavaScriptTypeScriptLanguageServerDocument(
        document("vue", "/project/src/App.vue"),
      ),
    ).toBe(true);
  });

  it("does not route PHP or plaintext documents through the JS/TS server", () => {
    expect(isJavaScriptTypeScriptLanguageServerDocument(document("php"))).toBe(
      false,
    );
    expect(
      isJavaScriptTypeScriptLanguageServerDocument(document("plaintext")),
    ).toBe(false);
  });
});

describe("languageServerLanguageIdForDocument", () => {
  it("maps Vue single file components to the vue language id", () => {
    expect(
      languageServerLanguageIdForDocument(
        document("vue", "/project/src/App.vue"),
      ),
    ).toBe("vue");
  });

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

  it("emits one canonical URI and rejects unsafe paths", () => {
    expect(fileUriFromPath("/project/./src/%name.ts")).toBe(
      "file:///project/src/%25name.ts",
    );
    expect(() => fileUriFromPath("/project/bad\0name.ts")).toThrow(TypeError);
  });

  it("rejects paths outside a scoped workspace", () => {
    const root = createWorkspaceRootFromPath("/project");

    expect(root.ok).toBe(true);
    if (!root.ok) {
      throw new Error(root.error.message);
    }

    expect(fileUriFromWorkspacePath(root.value, "/other/App.ts")).toBeNull();
    expect(fileUriFromWorkspacePath(root.value, "/project/App.ts")).toBe(
      "file:///project/App.ts",
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
        "/workspace-b/src/App.ts",
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
      languageServerUriSyncKey(
        "/workspace-b",
        fileUriFromPath("/workspace-b/src/App.ts"),
      ),
    );
  });

  it("uses the decoded canonical path for equivalent file URI version keys", () => {
    expect(
      languageServerUriSyncKey(
        "/project",
        "file:///project/src/User%20Service.ts",
      ),
    ).toBe(
      languageServerUriSyncKey(
        "/project/",
        "file://localhost/project/src/User%20Service.ts",
      ),
    );
  });

  it("converges encoded URI aliases through workspace path identity", () => {
    expect(
      languageServerUriSyncKey("/project", "file:///project/src/%41pp.ts"),
    ).toBe(languageServerDocumentSyncKey("/project/", "/project/src/App.ts"));
  });

  it.each([
    "https://example.test/project/App.ts",
    "file://server/project/App.ts",
    "file:///project/bad%2Fname.ts",
    "file:///project/bad%00name.ts",
    "file:///project/bad%ZZname.ts",
    "file:///other/App.ts",
  ])("rejects unsafe or non-workspace sync URI %s", (uri) => {
    expect(tryLanguageServerUriSyncKey("/project", uri)).toBeNull();
    expect(() => languageServerUriSyncKey("/project", uri)).not.toThrow();
    expect(languageServerUriSyncKey("/project", uri)).toBe(
      languageServerUriSyncKey("/project", uri),
    );
  });

  it("preserves Windows-native legacy sync keys", () => {
    const root = "C:\\project";
    const path = "C:\\project\\src\\App.ts";
    const key = languageServerDocumentSyncKey(root, path);

    expect(languageServerPathFromDocumentSyncKey(root, key)).toBe(
      "C:/project/src/App.ts",
    );
    expect(
      tryLanguageServerUriSyncKey(root, "file:///C:/project/src/App.ts"),
    ).toBe(key);
    expect(
      tryLanguageServerUriSyncKey(
        root,
        "file://localhost/C:/project/src/%41pp.ts",
      ),
    ).toBe(key);
  });

  it.each([
    "file:///C:/project/src/bad%2Fname.ts",
    "file:///C:/project/src/bad%5Cname.ts",
    "file:///C:/project/src/bad%00name.ts",
    "file:///C:/other/App.ts",
  ])("rejects unsafe Windows compatibility URI %s", (uri) => {
    expect(tryLanguageServerUriSyncKey("C:\\project", uri)).toBeNull();
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
