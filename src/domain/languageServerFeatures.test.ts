import { describe, expect, it } from "vitest";
import {
  canUseLanguageServerFeature,
  emptyLanguageServerCompletionList,
  pathFromLanguageServerUri,
  workspacePathFromLanguageServerUri,
  toEditorPosition,
  toLanguageServerTextDocumentPosition,
} from "./languageServerFeatures";
import type { LanguageServerCapabilities } from "./languageServerRuntime";
import { createWorkspaceRootFromPath } from "./workspacePath";

describe("canUseLanguageServerFeature", () => {
  it("reads a feature flag from the provider capability registry", () => {
    const capabilities: LanguageServerCapabilities = {
      callHierarchy: false,
      codeAction: false,
      codeActionResolve: false,
      codeLens: false,
      completion: false,
      declaration: false,
      definition: true,
      documentHighlight: false,
      documentLink: false,
      documentSymbol: false,
      didCreateFiles: false,
      didDeleteFiles: false,
      didRenameFiles: false,
      foldingRange: false,
      formatting: false,
      hover: true,
      implementation: false,
      inlayHint: false,
      linkedEditingRange: false,
      onTypeFormatting: false,
      prepareRename: false,
      rangeFormatting: false,
      references: false,
      rename: false,
      selectionRange: false,
      semanticTokens: false,
      signatureHelp: false,
      sourceDefinition: false,
      typeDefinition: false,
      typeHierarchy: false,
      willCreateFiles: false,
      willDeleteFiles: false,
      willRenameFiles: false,
      workspaceSymbol: false,
    };

    expect(canUseLanguageServerFeature(capabilities, "hover")).toBe(true);
    expect(canUseLanguageServerFeature(capabilities, "completion")).toBe(false);
    expect(canUseLanguageServerFeature(capabilities, "definition")).toBe(true);
  });
});

describe("toLanguageServerTextDocumentPosition", () => {
  it("converts editor positions to zero-based LSP positions", () => {
    expect(
      toLanguageServerTextDocumentPosition("/project/src/User.php", {
        column: 5,
        lineNumber: 12,
      }),
    ).toEqual({
      character: 4,
      line: 11,
      path: "/project/src/User.php",
    });
  });

  it("clamps invalid editor positions to the start of the document", () => {
    expect(
      toLanguageServerTextDocumentPosition("/project/src/User.php", {
        column: 0,
        lineNumber: 0,
      }),
    ).toEqual({
      character: 0,
      line: 0,
      path: "/project/src/User.php",
    });
  });
});

describe("toEditorPosition", () => {
  it("converts zero-based LSP positions to editor positions", () => {
    expect(toEditorPosition({ character: 3, line: 9 })).toEqual({
      column: 4,
      lineNumber: 10,
    });
  });
});

describe("pathFromLanguageServerUri", () => {
  it("decodes file URIs", () => {
    expect(pathFromLanguageServerUri("file:///project/src/User%20Model.php")).toBe(
      "/project/src/User Model.php",
    );
  });

  it("returns null for unsupported URIs", () => {
    expect(pathFromLanguageServerUri("https://example.test/User.php")).toBeNull();
    expect(pathFromLanguageServerUri("not a uri")).toBeNull();
  });

  it.each([
    "file://server/project/User.php",
    "file:///project/bad%2Fname.php",
    "file:///project/bad%00name.php",
    "file:///project/bad%ZZname.php",
  ])("rejects hostile file URI %s", (uri) => {
    expect(pathFromLanguageServerUri(uri)).toBeNull();
  });

  it("canonicalizes localhost and encoded aliases", () => {
    expect(pathFromLanguageServerUri("file://LOCALHOST/project/%55ser.php")).toBe(
      "/project/User.php",
    );
  });

  it("rejects local files outside a scoped workspace", () => {
    const root = createWorkspaceRootFromPath("/project");

    expect(root.ok).toBe(true);
    if (!root.ok) {
      throw new Error(root.error.message);
    }

    expect(
      workspacePathFromLanguageServerUri(
        root.value,
        "file:///other/User.php",
      ),
    ).toBeNull();
  });
});

describe("emptyLanguageServerCompletionList", () => {
  it("creates an empty non-incomplete completion list", () => {
    expect(emptyLanguageServerCompletionList()).toEqual({
      isIncomplete: false,
      items: [],
    });
  });
});
