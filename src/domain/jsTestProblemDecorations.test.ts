import { describe, expect, it } from "vitest";
import type { JsTestExplorerCurrentFileIdentity } from "./jsTestExplorerFilter";
import {
  jsTestProblemLineDecorations,
  type JsTestProblemLineDecoration,
} from "./jsTestProblemDecorations";
import type { JsTestProblemEntry, JsTestProblemsSnapshot } from "./jsTestProblems";
import { createWorkspaceRoot, parseWorkspacePath, type WorkspacePathPolicy } from "./workspacePath";

const caseInsensitivePolicy: WorkspacePathPolicy = {
  caseSensitive: false,
  foldCase: (value) => value.toLocaleLowerCase("en-US"),
  unicodeNormalization: "NFC",
};

describe("JavaScript test problem line decorations", () => {
  it("groups matching entries once per line in first-seen snapshot order", () => {
    const currentFile = identity();
    const first = entry(8, "first");
    const second = entry(3, "second");
    const sameLine = entry(8, "third");

    expect(project(snapshot([first, second, sameLine]), currentFile)).toEqual([
      { entries: [first, sameLine], lineNumber: 8 },
      { entries: [second], lineNumber: 3 },
    ]);
  });

  it("returns deeply immutable cloned output with the primary entry first", () => {
    const original = entry(8, "primary");
    const secondary = entry(8, "secondary");
    const decorations = project(snapshot([original, secondary]));

    expect(Object.isFrozen(decorations)).toBe(true);
    expect(Object.isFrozen(decorations[0])).toBe(true);
    expect(Object.isFrozen(decorations[0]?.entries)).toBe(true);
    expect(decorations[0]?.entries.every(Object.isFrozen)).toBe(true);
    expect(decorations[0]?.entries.map(({ message }) => message)).toEqual(["primary", "secondary"]);
    expect(decorations[0]?.entries[0]).not.toBe(original);
  });

  it("requires the exact workspace owner and root authority", () => {
    const currentFile = identity();

    expect(project(snapshot([entry(8, "foreign")], { workspaceId: "other" }), currentFile)).toEqual(
      [],
    );
    expect(
      project(snapshot([entry(8, "nested")], { rootKey: "/workspace/nested" }), currentFile),
    ).toEqual([]);
    expect(project(snapshot([entry(8, "outside")], { rootKey: "/other" }), currentFile)).toEqual(
      [],
    );
  });

  it("uses the root WorkspacePathKey policy for case and Unicode aliases", () => {
    const currentFile = identity({
      path: "/Workspace/src/Café.test.ts",
      policy: caseInsensitivePolicy,
      rootPath: "/Workspace",
    });
    const owned = snapshot(
      [
        entry(4, "case alias", "SRC/café.TEST.ts"),
        entry(7, "unicode alias", "src/cafe\u0301.test.ts"),
      ],
      { rootKey: "/workspace" },
    );

    expect(project(owned, currentFile).map(({ lineNumber }) => lineNumber)).toEqual([4, 7]);
    expect(
      project(
        owned,
        identity({
          path: "/Workspace/src/other.test.ts",
          policy: caseInsensitivePolicy,
          rootPath: "/Workspace",
        }),
      ),
    ).toEqual([]);
  });

  it("keeps case-sensitive identities distinct", () => {
    expect(project(snapshot([entry(4, "wrong case", "src/Example.test.ts")]), identity())).toEqual(
      [],
    );
  });

  it("rejects forged, outside, malformed, and non-file current identities", () => {
    const valid = identity();
    const candidates: JsTestExplorerCurrentFileIdentity[] = [
      { ...valid, pathKey: identity({ path: "/workspace/src/other.test.ts" }).pathKey },
      { ...valid, relativeFilePath: "../outside.test.ts" },
      { ...valid, relativeFilePath: "src/./example.test.ts" },
      { ...valid, relativeFilePath: "" },
      {
        ...valid,
        root: { ...valid.root, nativePath: "/other" as never },
      },
    ];

    for (const candidate of candidates) {
      expect(project(snapshot([entry(8, "failure")]), candidate)).toEqual([]);
    }
  });

  it("drops malformed and nonmatching entry paths without losing valid matches", () => {
    const malformed = [
      entry(2, "absolute", "/workspace/src/example.test.ts"),
      entry(3, "traversal", "../src/example.test.ts"),
      entry(4, "dot", "src/./example.test.ts"),
      entry(5, "outside file", "src/other.test.ts"),
      { ...entry(6, "bad line"), lineNumber: 0 },
    ];

    expect(project(snapshot([...malformed, entry(9, "valid")]))).toEqual([
      { entries: [entry(9, "valid")], lineNumber: 9 },
    ]);
  });

  it("drops malformed entry presentation fields before they reach an editor mapper", () => {
    const malformed = [
      { ...entry(2, "message"), message: null },
      { ...entry(3, "name"), name: 42 },
      { ...entry(4, "status"), status: "passed" },
    ] as unknown as JsTestProblemEntry[];

    expect(project(snapshot([...malformed, entry(9, "valid")]))).toEqual([
      { entries: [entry(9, "valid")], lineNumber: 9 },
    ]);
  });

  it("fails closed for malformed snapshot owner and excessive entry collections", () => {
    expect(
      project({
        ...snapshot([entry(8, "failure")]),
        owner: { rootKey: "/workspace/", workspaceId: "workspace-id" },
      }),
    ).toEqual([]);
    expect(
      project({
        ...snapshot([]),
        entries: Array.from({ length: 5_001 }, () => entry(8, "failure")),
      }),
    ).toEqual([]);
  });

  it("does not retain authority across workspace A-B-A replacement", () => {
    const ownerA = identity({
      path: "/workspace-a/src/a.test.ts",
      rootPath: "/workspace-a",
      workspaceId: "owner-a",
    });
    const ownerB = identity({
      path: "/workspace-b/src/b.test.ts",
      rootPath: "/workspace-b",
      workspaceId: "owner-b",
    });
    const replacementA = identity({
      path: "/workspace-a/src/a.test.ts",
      rootPath: "/workspace-a",
      workspaceId: "owner-a-2",
    });
    const snapshotA = snapshot([entry(2, "A", "src/a.test.ts")], {
      rootKey: "/workspace-a",
      workspaceId: "owner-a",
    });
    const snapshotB = snapshot([entry(3, "B", "src/b.test.ts")], {
      rootKey: "/workspace-b",
      workspaceId: "owner-b",
    });
    const replacementSnapshot = snapshot([entry(4, "A2", "src/a.test.ts")], {
      rootKey: "/workspace-a",
      workspaceId: "owner-a-2",
    });

    expect(project(snapshotA, ownerA)[0]?.entries[0]?.message).toBe("A");
    expect(project(snapshotA, ownerB)).toEqual([]);
    expect(project(snapshotA, replacementA)).toEqual([]);
    expect(project(snapshotB, ownerB)[0]?.entries[0]?.message).toBe("B");
    expect(project(replacementSnapshot, replacementA)[0]?.entries[0]?.message).toBe("A2");
  });
});

function project(
  source: JsTestProblemsSnapshot,
  currentFile = identity(),
): readonly JsTestProblemLineDecoration[] {
  return jsTestProblemLineDecorations(source, currentFile);
}

function snapshot(
  entries: readonly JsTestProblemEntry[],
  owner: Partial<JsTestProblemsSnapshot["owner"]> = {},
): JsTestProblemsSnapshot {
  return {
    entries: [...entries],
    generation: 1,
    owner: {
      rootKey: owner.rootKey ?? "/workspace",
      workspaceId: owner.workspaceId ?? "workspace-id",
    },
    total: entries.length,
    truncated: false,
  };
}

function entry(
  lineNumber: number,
  message: string,
  filePath = "src/example.test.ts",
): JsTestProblemEntry {
  return {
    filePath,
    lineNumber,
    message,
    name: message,
    status: "failed",
  };
}

function identity({
  path = "/workspace/src/example.test.ts",
  policy,
  rootPath = "/workspace",
  workspaceId = "workspace-id",
}: {
  path?: string;
  policy?: WorkspacePathPolicy;
  rootPath?: string;
  workspaceId?: string;
} = {}): JsTestExplorerCurrentFileIdentity {
  const root = createWorkspaceRoot(workspaceId, rootPath, policy);
  if (!root.ok) throw new Error(root.error.message);
  const parsed = parseWorkspacePath(root.value, path);
  if (!parsed.ok || !parsed.value.relativePath) throw new Error("Expected owned file identity.");
  return Object.freeze({
    pathKey: parsed.value.key,
    relativeFilePath: parsed.value.relativePath,
    root: root.value,
  });
}
