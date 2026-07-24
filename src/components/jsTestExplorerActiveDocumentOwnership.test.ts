import { describe, expect, it } from "vitest";
import {
  MAX_JS_TEST_EXPLORER_OPENED_FILES,
  type JsTestExplorerOpenedFilesSnapshot,
} from "../domain/jsTestExplorerFilter";
import type { EditorDocument } from "../domain/workspace";
import { DEFAULT_WORKSPACE_PATH_POLICY, type WorkspacePathPolicy } from "../domain/workspacePath";
import {
  MAX_JS_TEST_EXPLORER_OPENED_DOCUMENT_CANDIDATES,
  jsTestExplorerActiveDocumentIdentity,
  jsTestExplorerOpenedDocumentIdentitySnapshot,
  type JsTestExplorerActiveDocumentWorkspace,
} from "./jsTestExplorerActiveDocumentOwnership";

describe("JavaScript Test Explorer active-document ownership", () => {
  it("projects one exact active workspace document", () => {
    expect(relativePath({ activeDocument: document() })?.relativeFilePath).toBe(
      "src/example.test.ts",
    );
    expect(
      relativePath({ activeDocument: document({ language: "javascript" }) })?.relativeFilePath,
    ).toBe("src/example.test.ts");
  });

  it("keeps URI ownership independent from dirty state and language", () => {
    expect(relativePath({ activeDocument: document({ content: "dirty" }) })?.relativeFilePath).toBe(
      "src/example.test.ts",
    );
    expect(
      relativePath({
        activeDocument: document({
          language: "php",
          path: "/workspace/src/example.test.php",
        }),
      })?.relativeFilePath,
    ).toBe("src/example.test.php");
  });

  it.each([
    [
      "untitled",
      {
        activeDocument: document({ path: "untitled:Untitled-1" }),
      },
    ],
    [
      "outside the workspace",
      {
        activeDocument: document({ path: "/other/src/example.test.ts" }),
      },
    ],
    [
      "owned by a different selected workspace",
      {
        workspace: workspace({ selectedPath: "/replacement" }),
      },
    ],
    [
      "incomplete legacy workspace descriptor",
      {
        workspace: { ...workspace(), selectedPath: undefined } as never,
      },
    ],
  ])("rejects a %s active document", (_label, overrides) => {
    expect(relativePath(overrides)).toBeNull();
  });

  it("tracks workspace A-B-A replacement without retaining either prior owner", () => {
    const ownerA = {
      activeDocument: document({ path: "/workspace-a/src/a.test.ts" }),
      workspace: workspace({ selectedPath: "/workspace-a", workspaceId: "owner-a" }),
      workspaceRoot: "/workspace-a",
    };
    const ownerB = {
      activeDocument: document({ path: "/workspace-b/src/b.test.ts" }),
      workspace: workspace({ selectedPath: "/workspace-b", workspaceId: "owner-b" }),
      workspaceRoot: "/workspace-b",
    };

    expect(jsTestExplorerActiveDocumentIdentity(ownerA)?.relativeFilePath).toBe("src/a.test.ts");
    expect(jsTestExplorerActiveDocumentIdentity(ownerB)?.relativeFilePath).toBe("src/b.test.ts");
    expect(
      jsTestExplorerActiveDocumentIdentity({
        ...ownerA,
        activeDocument: document({ path: "/workspace-a/src/final-a.test.ts" }),
      })?.relativeFilePath,
    ).toBe("src/final-a.test.ts");
  });

  it("tracks same-path model A-B-A identity without retaining document contents", () => {
    const modelA = document();
    const modelB = document({ content: "dirty model B" });
    const replacementA = document();

    expect(relativePath({ activeDocument: modelA })?.relativeFilePath).toBe("src/example.test.ts");
    expect(relativePath({ activeDocument: modelB })?.relativeFilePath).toBe("src/example.test.ts");
    expect(relativePath({ activeDocument: replacementA })?.relativeFilePath).toBe(
      "src/example.test.ts",
    );
  });

  it("builds one deterministic immutable opened-file snapshot and drops invalid items", () => {
    const openedEditorResourcePaths = [
      "/workspace/src/c.test.ts",
      "untitled:Untitled-1",
      "/workspace/src/b.php",
      "/other/outside.test.ts",
      "/workspace/src/a.test.ts",
    ];

    const snapshot = openedFiles({ openedEditorResourcePaths });

    expect(snapshot.identities.map(({ relativeFilePath }) => relativeFilePath)).toEqual([
      "src/a.test.ts",
      "src/b.php",
      "src/c.test.ts",
    ]);
    expect(snapshot.hadEditorResources).toBe(true);
    expect(snapshot.root.workspaceId).toBe("workspace-id");
    expect(snapshot.truncated).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.identities)).toBe(true);
    expect(snapshot.identities.every(Object.isFrozen)).toBe(true);
    expect(new Set(snapshot.identities.map(({ root }) => root)).size).toBe(1);
    expect(snapshot.identities[0]?.root.workspaceId).toBe("workspace-id");
  });

  it("deduplicates filesystem aliases by WorkspacePathKey independently of input order", () => {
    const workspaceOwner = workspace({ policy: insensitivePolicy });
    const upper = document({ path: "/workspace/src/Example.test.ts" });
    const lower = document({ path: "/workspace/src/example.test.ts" });

    const first = openedFiles({
      openedEditorResourcePaths: [lower.path, upper.path],
      workspace: workspaceOwner,
    });
    const second = openedFiles({
      openedEditorResourcePaths: [upper.path, lower.path],
      workspace: workspaceOwner,
    });

    expect(first.identities).toHaveLength(1);
    expect(first.identities[0]?.relativeFilePath).toBe("src/Example.test.ts");
    expect(
      second.identities.map(({ pathKey, relativeFilePath, root }) => ({
        pathKey,
        relativeFilePath,
        workspaceId: root.workspaceId,
      })),
    ).toEqual(
      first.identities.map(({ pathKey, relativeFilePath, root }) => ({
        pathKey,
        relativeFilePath,
        workspaceId: root.workspaceId,
      })),
    );
  });

  it("caps unique identities deterministically and fails closed for an excessive snapshot", () => {
    const paths = Array.from(
      { length: MAX_JS_TEST_EXPLORER_OPENED_FILES + 1 },
      (_, index) => `/workspace/src/${String(index).padStart(3, "0")}.test.ts`,
    ).reverse();
    const capped = openedFiles({ openedEditorResourcePaths: paths });

    expect(capped.identities).toEqual([]);
    expect(capped.hadEditorResources).toBe(true);
    expect(capped.root.workspaceId).toBe("workspace-id");
    expect(capped.truncated).toBe(true);

    const overflow = openedFiles({
      openedEditorResourcePaths: Array.from(
        { length: MAX_JS_TEST_EXPLORER_OPENED_DOCUMENT_CANDIDATES + 1 },
        (_, index) => `/workspace/src/${index}.test.ts`,
      ),
    });
    expect(overflow.identities).toEqual([]);
    expect(overflow.hadEditorResources).toBe(true);
    expect(overflow.root.workspaceId).toBe("workspace-id");
    expect(overflow.truncated).toBe(true);
    expect(Object.isFrozen(overflow)).toBe(true);
    expect(Object.isFrozen(overflow.identities)).toBe(true);
  });

  it("distinguishes unavailable ownership from an available empty editor-resource snapshot", () => {
    expect(
      jsTestExplorerOpenedDocumentIdentitySnapshot({
        openedEditorResourcePaths: [],
        workspace: null,
        workspaceRoot: "/workspace",
      }),
    ).toBeNull();

    const available = openedFiles({ openedEditorResourcePaths: [] });
    expect(available.hadEditorResources).toBe(false);
    expect(available.identities).toEqual([]);
    expect(available.root.workspaceId).toBe("workspace-id");
    expect(available.truncated).toBe(false);
  });

  it("rebinds every opened-file identity across workspace A-B-A replacement", () => {
    const snapshotA = openedFiles({
      openedEditorResourcePaths: ["/workspace-a/src/a.test.ts"],
      workspace: workspace({ selectedPath: "/workspace-a", workspaceId: "owner-a" }),
      workspaceRoot: "/workspace-a",
    });
    const snapshotB = openedFiles({
      openedEditorResourcePaths: ["/workspace-b/src/b.test.ts"],
      workspace: workspace({ selectedPath: "/workspace-b", workspaceId: "owner-b" }),
      workspaceRoot: "/workspace-b",
    });
    const replacementA = openedFiles({
      openedEditorResourcePaths: ["/workspace-a/src/final.test.ts"],
      workspace: workspace({ selectedPath: "/workspace-a", workspaceId: "owner-a-2" }),
      workspaceRoot: "/workspace-a",
    });

    expect(snapshotA.identities[0]?.root.workspaceId).toBe("owner-a");
    expect(snapshotB.identities[0]?.root.workspaceId).toBe("owner-b");
    expect(replacementA.identities[0]?.root.workspaceId).toBe("owner-a-2");
    expect(replacementA.identities[0]?.relativeFilePath).toBe("src/final.test.ts");
  });
});

function relativePath(
  overrides: Partial<Parameters<typeof jsTestExplorerActiveDocumentIdentity>[0]> = {},
) {
  return jsTestExplorerActiveDocumentIdentity({
    activeDocument: overrides.activeDocument ?? document(),
    workspace: overrides.workspace === undefined ? workspace() : overrides.workspace,
    workspaceRoot: overrides.workspaceRoot === undefined ? "/workspace" : overrides.workspaceRoot,
  });
}

function openedFiles(
  overrides: Partial<Parameters<typeof jsTestExplorerOpenedDocumentIdentitySnapshot>[0]> = {},
): JsTestExplorerOpenedFilesSnapshot {
  const snapshot = jsTestExplorerOpenedDocumentIdentitySnapshot({
    openedEditorResourcePaths: overrides.openedEditorResourcePaths ?? [],
    workspace: overrides.workspace === undefined ? workspace() : overrides.workspace,
    workspaceRoot: overrides.workspaceRoot === undefined ? "/workspace" : overrides.workspaceRoot,
  });
  if (!snapshot) throw new Error("Expected an available opened-file snapshot.");
  return snapshot;
}

function document(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "test('works', () => undefined);",
    language: "typescript",
    name: "example.test.ts",
    path: "/workspace/src/example.test.ts",
    savedContent: "test('works', () => undefined);",
    ...overrides,
  };
}

function workspace(
  overrides: Partial<JsTestExplorerActiveDocumentWorkspace> = {},
): JsTestExplorerActiveDocumentWorkspace {
  return {
    policy: DEFAULT_WORKSPACE_PATH_POLICY,
    selectedPath: "/workspace",
    workspaceId: "workspace-id",
    ...overrides,
  };
}

const insensitivePolicy: WorkspacePathPolicy = Object.freeze({
  caseSensitive: false,
  foldCase: (value: string) => value.toLocaleLowerCase("en-US"),
  unicodeNormalization: "none",
});
