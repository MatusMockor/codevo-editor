import { describe, expect, it } from "vitest";
import type { JsTestExplorerCurrentFileIdentity } from "../domain/jsTestExplorerFilter";
import type { JsTestProblemEntry, JsTestProblemsSnapshot } from "../domain/jsTestProblems";
import { joinWorkspacePath, type EditorDocument } from "../domain/workspace";
import {
  createWorkspaceRoot,
  DEFAULT_WORKSPACE_PATH_POLICY,
  parseWorkspacePath,
  type WorkspacePathPolicy,
} from "../domain/workspacePath";
import { selectJsTestProblemDecorations } from "./jsTestProblemDecorationSelection";

describe("JavaScript test problem decoration selection", () => {
  it("selects immutable line models for the exact clean active document", () => {
    const identity = currentFileIdentity("/workspace", "src/example.test.ts");
    const selection = selectJsTestProblemDecorations({
      activeDocument: document(),
      currentFileIdentity: identity,
      snapshot: snapshot(identity, [
        problem("src/example.test.ts", 8, "first"),
        problem("src/example.test.ts", 8, "second"),
        problem("src/example.test.ts", 12, "third"),
        problem("src/other.test.ts", 4, "foreign file"),
      ]),
    });

    expect(selection.map(({ lineNumber, entries }) => [lineNumber, entries.length])).toEqual([
      [8, 2],
      [12, 1],
    ]);
    expect(Object.isFrozen(selection)).toBe(true);
    expect(selection.every(Object.isFrozen)).toBe(true);
    expect(selection.every(({ entries }) => Object.isFrozen(entries))).toBe(true);
  });

  it("rejects null, malformed, unsupported, and path-inconsistent active state", () => {
    const identity = currentFileIdentity("/workspace", "src/example.test.ts");
    const ownedSnapshot = snapshot(identity, [problem("src/example.test.ts", 8, "failure")]);
    const valid = {
      activeDocument: document(),
      currentFileIdentity: identity,
      snapshot: ownedSnapshot,
    };

    for (const candidate of [
      { ...valid, activeDocument: null },
      { ...valid, currentFileIdentity: null },
      { ...valid, snapshot: null },
      { ...valid, activeDocument: document({ language: "php" }) },
      { ...valid, activeDocument: document({ path: "/workspace/src/other.test.ts" }) },
      {
        ...valid,
        currentFileIdentity: { ...identity, relativeFilePath: "src/other.test.ts" },
      },
      { ...valid, snapshot: { ...ownedSnapshot, generation: -1 } },
      { ...valid, snapshot: { ...ownedSnapshot, total: 0 } },
      { ...valid, snapshot: { ...ownedSnapshot, generation: 0 } },
      { ...valid, snapshot: { ...ownedSnapshot, total: 2, truncated: false } },
      {
        ...valid,
        snapshot: {
          ...ownedSnapshot,
          entries: [{ ...ownedSnapshot.entries[0], message: null }],
        },
      },
      {
        ...valid,
        snapshot: {
          ...ownedSnapshot,
          entries: [{ ...ownedSnapshot.entries[0], name: 42 }],
        },
      },
      {
        ...valid,
        snapshot: {
          ...ownedSnapshot,
          entries: [{ ...ownedSnapshot.entries[0], status: "passed" }],
        },
      },
    ]) {
      const selection = selectJsTestProblemDecorations(candidate as never);
      expect(selection).toEqual([]);
      expect(Object.isFrozen(selection)).toBe(true);
    }
  });

  it("accepts only the canonical empty generation-zero snapshot", () => {
    const identity = currentFileIdentity("/workspace", "src/example.test.ts");
    const empty = snapshot(identity, [], 0);

    const selection = selectJsTestProblemDecorations({
      activeDocument: document(),
      currentFileIdentity: identity,
      snapshot: empty,
    });

    expect(selection).toEqual([]);
    expect(Object.isFrozen(selection)).toBe(true);
  });

  it("suppresses dirty disk results and restores them when the document is clean again", () => {
    const identity = currentFileIdentity("/workspace", "src/example.test.ts");
    const ownedSnapshot = snapshot(identity, [problem("src/example.test.ts", 8, "failure")]);

    expect(
      selectJsTestProblemDecorations({
        activeDocument: document({ content: "changed" }),
        currentFileIdentity: identity,
        snapshot: ownedSnapshot,
      }),
    ).toEqual([]);
    expect(
      selectJsTestProblemDecorations({
        activeDocument: document({ content: "changed", savedContent: "changed" }),
        currentFileIdentity: identity,
        snapshot: ownedSnapshot,
      }).map(({ lineNumber }) => lineNumber),
    ).toEqual([8]);
  });

  it("rejects foreign workspace and root owners including same-path stale generations", () => {
    const active = currentFileIdentity("/workspace", "src/example.test.ts", undefined, "owner-b");
    const foreignWorkspace = currentFileIdentity(
      "/workspace",
      "src/example.test.ts",
      undefined,
      "owner-a",
    );
    const foreignRoot = currentFileIdentity("/other", "src/example.test.ts", undefined, "owner-b");

    for (const stale of [
      snapshot(foreignWorkspace, [problem("src/example.test.ts", 8, "old owner")], 99),
      snapshot(foreignRoot, [problem("src/example.test.ts", 8, "old root")], 99),
    ]) {
      expect(
        selectJsTestProblemDecorations({
          activeDocument: document(),
          currentFileIdentity: active,
          snapshot: stale,
        }),
      ).toEqual([]);
    }
  });

  it("re-evaluates ownership across an A to B to replacement-A cycle", () => {
    const identityA = currentFileIdentity("/workspace-a", "src/a.test.ts", undefined, "owner-a");
    const identityB = currentFileIdentity("/workspace-b", "src/b.test.ts", undefined, "owner-b");
    const replacementA = currentFileIdentity(
      "/workspace-a",
      "src/final.test.ts",
      undefined,
      "owner-a-2",
    );
    const snapshotA = snapshot(identityA, [problem("src/a.test.ts", 2, "A")], 7);
    const snapshotB = snapshot(identityB, [problem("src/b.test.ts", 3, "B")], 1);
    const replacementSnapshotA = snapshot(
      replacementA,
      [problem("src/final.test.ts", 5, "replacement A")],
      1,
    );

    expect(
      selectJsTestProblemDecorations({
        activeDocument: document({ path: "/workspace-a/src/a.test.ts" }),
        currentFileIdentity: identityA,
        snapshot: snapshotA,
      }).map(({ lineNumber }) => lineNumber),
    ).toEqual([2]);
    expect(
      selectJsTestProblemDecorations({
        activeDocument: document({ path: "/workspace-b/src/b.test.ts" }),
        currentFileIdentity: identityB,
        snapshot: snapshotA,
      }),
    ).toEqual([]);
    expect(
      selectJsTestProblemDecorations({
        activeDocument: document({ path: "/workspace-b/src/b.test.ts" }),
        currentFileIdentity: identityB,
        snapshot: snapshotB,
      }).map(({ lineNumber }) => lineNumber),
    ).toEqual([3]);
    expect(
      selectJsTestProblemDecorations({
        activeDocument: document({ path: "/workspace-a/src/final.test.ts" }),
        currentFileIdentity: replacementA,
        snapshot: snapshotA,
      }),
    ).toEqual([]);
    expect(
      selectJsTestProblemDecorations({
        activeDocument: document({ path: "/workspace-a/src/final.test.ts" }),
        currentFileIdentity: replacementA,
        snapshot: replacementSnapshotA,
      }).map(({ lineNumber }) => lineNumber),
    ).toEqual([5]);
  });

  it("uses the workspace path policy for case and Unicode aliases", () => {
    const policy: WorkspacePathPolicy = {
      caseSensitive: false,
      foldCase: (value) => value.toLocaleLowerCase("en-US"),
      unicodeNormalization: "NFC",
    };
    const identity = currentFileIdentity("/workspace", "SRC/cafe\u0301.TEST.TS", policy);

    expect(
      selectJsTestProblemDecorations({
        activeDocument: document({ path: "/workspace/src/café.test.ts" }),
        currentFileIdentity: identity,
        snapshot: snapshot(identity, [problem("src/café.test.ts", 9, "failure")]),
      }).map(({ lineNumber }) => lineNumber),
    ).toEqual([9]);
  });
});

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

function currentFileIdentity(
  rootPath: string,
  relativeFilePath: string,
  policy: WorkspacePathPolicy = DEFAULT_WORKSPACE_PATH_POLICY,
  workspaceId = "workspace-id",
): JsTestExplorerCurrentFileIdentity {
  const root = createWorkspaceRoot(workspaceId, rootPath, policy);
  if (!root.ok) throw new Error(root.error.message);
  const path = parseWorkspacePath(
    root.value,
    joinWorkspacePath(root.value.nativePath, relativeFilePath),
  );
  if (!path.ok) throw new Error(path.error.message);
  return { pathKey: path.value.key, relativeFilePath, root: root.value };
}

function problem(filePath: string, lineNumber: number, message: string): JsTestProblemEntry {
  return Object.freeze({
    filePath,
    lineNumber,
    message,
    name: message,
    status: "failed",
  });
}

function snapshot(
  identity: JsTestExplorerCurrentFileIdentity,
  entries: readonly JsTestProblemEntry[],
  generation = 1,
): JsTestProblemsSnapshot {
  return Object.freeze({
    entries: Object.freeze([...entries]),
    generation,
    owner: Object.freeze({
      rootKey: identity.root.nativePath,
      workspaceId: identity.root.workspaceId,
    }),
    total: entries.length,
    truncated: false,
  });
}
