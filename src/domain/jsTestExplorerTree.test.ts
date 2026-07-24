import { describe, expect, it } from "vitest";
import type { TestGutterTarget } from "./testGutterTargets";
import type {
  JsTestExplorerCurrentFileIdentity,
  JsTestExplorerOpenedFilesSnapshot,
} from "./jsTestExplorerFilter";
import { joinWorkspacePath } from "./workspace";
import {
  createWorkspaceRoot,
  DEFAULT_WORKSPACE_PATH_POLICY,
  parseWorkspacePath,
  type WorkspacePathPolicy,
} from "./workspacePath";
import {
  buildJsTestExplorerTree,
  filterJsTestExplorerTree,
  flattenJsTestExplorerTree,
  jsTestExplorerTestId,
  type JsTestExplorerTestDiscovery,
} from "./jsTestExplorerTree";

function target(filter: string, lineNumber: number): TestGutterTarget {
  return {
    filter,
    kind: "method",
    label: `Run ${filter}`,
    match: "description",
    position: { column: 3, lineNumber },
  };
}

function discovery(
  filePath: string,
  suitePath: readonly string[],
  filter: string,
  lineNumber: number,
  status: JsTestExplorerTestDiscovery["status"] = "idle",
): JsTestExplorerTestDiscovery {
  return { filePath, status, suitePath, target: target(filter, lineNumber) };
}

describe("JavaScript Test Explorer tree", () => {
  it("builds a deterministic file -> suite -> test tree with stable semantic IDs", () => {
    const refund = discovery("/workspace/refund.test.ts", ["refunds"], "rejects invalid refund", 8);
    const charge = discovery("/workspace/payment.test.ts", ["payments"], "charges card", 14);

    const left = buildJsTestExplorerTree("/workspace", [refund, charge]);
    const right = buildJsTestExplorerTree("/workspace", [charge, refund]);

    expect(left).toEqual(right);
    expect(left.children.map((file) => file.filePath)).toEqual([
      "/workspace/payment.test.ts",
      "/workspace/refund.test.ts",
    ]);
    expect(left.children[0]?.children[0]?.children[0]?.id).toBe(jsTestExplorerTestId(charge));
  });

  it("aggregates status recursively with failure and running precedence", () => {
    const tree = buildJsTestExplorerTree("/workspace", [
      discovery("/workspace/payment.test.ts", ["payments"], "passes", 4, "passed"),
      discovery("/workspace/payment.test.ts", ["payments"], "waits", 8, "running"),
      discovery("/workspace/payment.test.ts", ["refunds"], "fails", 12, "failed"),
      discovery("/workspace/other.test.ts", ["other"], "skips", 3, "skipped"),
    ]);

    expect(tree.status).toBe("failed");
    expect(tree.children[0]?.status).toBe("skipped");
    expect(tree.children[1]?.status).toBe("failed");
    expect(tree.children[1]?.children.find((suite) => suite.label === "payments")?.status).toBe(
      "running",
    );
  });

  it("keeps equal suite and test names isolated by file", () => {
    const tree = buildJsTestExplorerTree("/workspace", [
      discovery("/workspace/a.test.ts", ["shared"], "same test", 5, "failed"),
      discovery("/workspace/b.test.ts", ["shared"], "same test", 5, "passed"),
    ]);

    expect(tree.children.map(({ status }) => status)).toEqual(["failed", "passed"]);
    const ids = tree.children.map((file) => file.children[0]?.children[0]?.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("places tests outside describe in an idle synthetic root suite", () => {
    const tree = buildJsTestExplorerTree("/workspace", [
      discovery("/workspace/standalone.test.ts", [], "works standalone", 2),
    ]);

    expect(tree.status).toBe("idle");
    expect(tree.children[0]?.children[0]).toMatchObject({
      kind: "suite",
      label: "(root)",
      status: "idle",
      suitePath: [],
    });
  });

  it("filters by file, suite, or test text while preserving deterministic preorder flattening", () => {
    const tree = buildJsTestExplorerTree("/workspace", [
      discovery("/workspace/payment.test.ts", ["payments"], "charges card", 4, "passed"),
      discovery("/workspace/payment.test.ts", ["refunds"], "refunds card", 9, "failed"),
      discovery("/workspace/user.test.ts", ["users"], "creates user", 3, "passed"),
    ]);

    const filtered = filterJsTestExplorerTree(tree, "refund");
    const flattened = flattenJsTestExplorerTree(filtered);

    expect(flattened.map((node) => node.kind)).toEqual(["workspace", "file", "suite", "test"]);
    expect(flattened.map((node) => node.label)).toEqual([
      "/workspace",
      "payment.test.ts",
      "refunds",
      "refunds card",
    ]);
    expect(filtered.status).toBe("failed");
    expect(filterJsTestExplorerTree(tree, "missing").children).toEqual([]);
  });

  it("intersects the exact @failed term with text and keeps only failed leaves plus ancestors", () => {
    const tree = buildJsTestExplorerTree("/workspace", [
      discovery("/workspace/payment.test.ts", ["payments"], "charges card", 4, "passed"),
      discovery("/workspace/payment.test.ts", ["refunds"], "refunds card", 9, "failed"),
      discovery("/workspace/payment.test.ts", ["refunds"], "refunds cash", 12, "passed"),
      discovery("/workspace/user.test.ts", ["users"], "creates user", 3, "failed"),
    ]);

    expect(
      flattenJsTestExplorerTree(filterJsTestExplorerTree(tree, "@failed")).map(
        ({ kind, label }) => `${kind}:${label}`,
      ),
    ).toEqual([
      "workspace:/workspace",
      "file:payment.test.ts",
      "suite:refunds",
      "test:refunds card",
      "file:user.test.ts",
      "suite:users",
      "test:creates user",
    ]);
    expect(
      flattenJsTestExplorerTree(filterJsTestExplorerTree(tree, "payment @failed")).map(
        ({ label }) => label,
      ),
    ).toEqual(["/workspace", "payment.test.ts", "refunds", "refunds card"]);
    expect(filterJsTestExplorerTree(tree, "charges @failed").children).toEqual([]);
  });

  it("keeps every non-idle leaf and exact ancestry for @executed without changing statuses", () => {
    const tree = buildJsTestExplorerTree("/workspace", [
      discovery("/workspace/payment.test.ts", ["payments"], "idle payment", 2, "idle"),
      discovery("/workspace/payment.test.ts", ["payments"], "running payment", 4, "running"),
      discovery("/workspace/payment.test.ts", ["refunds", "card"], "passed refund", 8, "passed"),
      discovery("/workspace/payment.test.ts", ["refunds", "cash"], "failed refund", 12, "failed"),
      discovery("/workspace/user.test.ts", ["users"], "skipped user", 3, "skipped"),
      discovery("/workspace/idle.test.ts", ["idle"], "never ran", 5, "idle"),
    ]);

    const projected = filterJsTestExplorerTree(tree, "@executed");

    expect(
      flattenJsTestExplorerTree(projected).map(
        ({ kind, label, status }) => `${kind}:${label}:${status}`,
      ),
    ).toEqual([
      "workspace:/workspace:failed",
      "file:payment.test.ts:failed",
      "suite:payments:running",
      "test:running payment:running",
      "suite:refunds:failed",
      "suite:card:passed",
      "test:passed refund:passed",
      "suite:cash:failed",
      "test:failed refund:failed",
      "file:user.test.ts:skipped",
      "suite:users:skipped",
      "test:skipped user:skipped",
    ]);
    expect(tree.children.find(({ label }) => label === "idle.test.ts")).toBeDefined();
    expect(projected.children.find(({ label }) => label === "idle.test.ts")).toBeUndefined();
  });

  it("gives exact @failed priority over @executed and composes executed with text and @doc", () => {
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [
        discovery("src/payment.test.ts", ["payments"], "refund running", 4, "running"),
        discovery("src/payment.test.ts", ["refunds"], "refund failed", 9, "failed"),
        discovery("src/payment.test.ts", ["refunds"], "refund idle", 12, "idle"),
        discovery("src/user.test.ts", ["users"], "refund passed", 3, "passed"),
      ],
      "workspace-id",
    );
    const options = {
      currentFile: currentFileIdentity("/workspace", "src/payment.test.ts"),
      workspaceId: "workspace-id",
    } as const;

    expect(
      flattenJsTestExplorerTree(filterJsTestExplorerTree(tree, "refund @executed @doc", options))
        .filter(({ kind }) => kind === "test")
        .map(({ label }) => label),
    ).toEqual(["refund running", "refund failed"]);
    expect(
      flattenJsTestExplorerTree(filterJsTestExplorerTree(tree, "@executed @failed @doc", options))
        .filter(({ kind }) => kind === "test")
        .map(({ label }) => label),
    ).toEqual(["refund failed"]);
  });

  it("composes @executed with @openedFiles and treats inexact casing as text", () => {
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [
        discovery("src/payment.test.ts", ["payments"], "running", 4, "running"),
        discovery("src/user.test.ts", ["users"], "passed", 7, "passed"),
        discovery("src/closed.test.ts", ["closed"], "failed", 9, "failed"),
        discovery("src/literal.test.ts", ["literal"], "@Executed label", 11, "idle"),
      ],
      "workspace-id",
    );

    const projected = filterJsTestExplorerTree(tree, "@executed @openedFiles", {
      openedFilesSnapshot: openedFilesSnapshot([
        currentFileIdentity("/workspace", "src/payment.test.ts"),
        currentFileIdentity("/workspace", "src/user.test.ts"),
      ]),
      workspaceId: "workspace-id",
    });

    expect(
      flattenJsTestExplorerTree(projected)
        .filter(({ kind }) => kind === "test")
        .map(({ label }) => label),
    ).toEqual(["running", "passed"]);
    expect(
      flattenJsTestExplorerTree(filterJsTestExplorerTree(tree, "@Executed"))
        .filter(({ kind }) => kind === "test")
        .map(({ label }) => label),
    ).toEqual(["@Executed label"]);
  });

  it("treats unknown and inexact @ terms as ordinary case-insensitive text", () => {
    const tree = buildJsTestExplorerTree("/workspace", [
      discovery("/workspace/payment.test.ts", ["payments"], "@FAILED is literal", 4, "failed"),
    ]);

    expect(filterJsTestExplorerTree(tree, "@FAILED").children).toHaveLength(1);
    expect(filterJsTestExplorerTree(tree, "@passed").children).toEqual([]);
  });

  it("projects Current File by exact canonical identity without recomputing ancestor statuses", () => {
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [
        discovery("src/payment.test.ts", ["payments"], "charges card", 4, "passed"),
        discovery("src/payment.test.ts", ["refunds"], "refunds card", 9, "failed"),
        discovery("src/payment.test.ts", ["refunds"], "refunds cash", 12, "passed"),
        discovery("src/user.test.ts", ["users"], "refunds user", 3, "failed"),
      ],
      "workspace-id",
    );

    const projected = filterJsTestExplorerTree(tree, "refund @doc @failed", {
      currentFile: currentFileIdentity("/workspace", "src/payment.test.ts"),
      workspaceId: "workspace-id",
    });

    expect(
      flattenJsTestExplorerTree(projected).map(({ kind, label }) => `${kind}:${label}`),
    ).toEqual([
      "workspace:/workspace",
      "file:payment.test.ts",
      "suite:refunds",
      "test:refunds card",
    ]);
    expect(projected.status).toBe(tree.status);
    expect(projected.children[0]?.status).toBe(
      tree.children.find(({ filePath }) => filePath === "src/payment.test.ts")?.status,
    );
    expect(projected.children[0]?.children[0]?.status).toBe("failed");
  });

  it("fails Current File projection closed for absent, invalid, or non-matching identity", () => {
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [discovery("src/payment.test.ts", ["payments"], "charges card", 4, "failed")],
      "workspace-id",
    );

    for (const currentFile of [
      null,
      {
        ...currentFileIdentity("/workspace", "src/payment.test.ts"),
        relativeFilePath: "src/./payment.test.ts",
      },
      currentFileIdentity("/workspace", "src/missing.test.ts"),
    ]) {
      expect(
        filterJsTestExplorerTree(tree, "@doc", {
          currentFile,
          workspaceId: "workspace-id",
        }).children,
      ).toEqual([]);
    }
  });

  it("leaves the full tree and canonical node identities untouched when Current File is omitted", () => {
    const tree = buildJsTestExplorerTree("/workspace", [
      discovery("/workspace/payment.test.ts", ["payments"], "charges card", 4, "failed"),
    ]);

    expect(filterJsTestExplorerTree(tree, "")).toBe(tree);
  });

  it("projects an exact canonical UNC Current File through the tree path representation", () => {
    const tree = buildJsTestExplorerTree(
      "//server/share",
      [discovery("payment.test.ts", ["payments"], "charges card", 4, "failed")],
      "workspace-id",
    );

    expect(
      filterJsTestExplorerTree(tree, "@doc", {
        currentFile: currentFileIdentity("//server/share", "payment.test.ts"),
        workspaceId: "workspace-id",
      }).children,
    ).toHaveLength(1);
  });

  it("matches Current File through authoritative case and Unicode identity policy", () => {
    const policy: WorkspacePathPolicy = {
      caseSensitive: false,
      foldCase: (value) => value.toLocaleLowerCase("en-US"),
      unicodeNormalization: "NFC",
    };
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [discovery("src/café.test.ts", ["payments"], "charges card", 4, "failed")],
      "workspace-id",
    );

    expect(
      filterJsTestExplorerTree(tree, "@doc", {
        currentFile: currentFileIdentity("/workspace", "SRC/cafe\u0301.TEST.TS", policy),
        workspaceId: "workspace-id",
      }).children,
    ).toHaveLength(1);
  });

  it("projects exact opened files and composes them with text and @failed through AND", () => {
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [
        discovery("src/payment.test.ts", ["payments"], "refunds card", 4, "failed"),
        discovery("src/user.test.ts", ["users"], "refunds user", 7, "passed"),
        discovery("src/closed.test.ts", ["closed"], "refunds closed", 9, "failed"),
      ],
      "workspace-id",
    );

    const projected = filterJsTestExplorerTree(tree, "refund @openedFiles @failed", {
      openedFilesSnapshot: openedFilesSnapshot([
        currentFileIdentity("/workspace", "src/payment.test.ts"),
        currentFileIdentity("/workspace", "src/user.test.ts"),
      ]),
      workspaceId: "workspace-id",
    });

    expect(
      flattenJsTestExplorerTree(projected).map(({ kind, label }) => `${kind}:${label}`),
    ).toEqual([
      "workspace:/workspace",
      "file:payment.test.ts",
      "suite:payments",
      "test:refunds card",
    ]);
    expect(projected.status).toBe(tree.status);
  });

  it("distinguishes zero editor resources from resources with zero owned identities", () => {
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [discovery("src/payment.test.ts", ["payments"], "refunds card", 4, "failed")],
      "workspace-id",
    );

    expect(
      filterJsTestExplorerTree(tree, "@openedFiles", {
        openedFilesSnapshot: openedFilesSnapshot([], { hadEditorResources: false }),
        workspaceId: "workspace-id",
      }),
    ).toBe(tree);
    expect(
      filterJsTestExplorerTree(tree, "@openedFiles", {
        openedFilesSnapshot: openedFilesSnapshot([], { hadEditorResources: true }),
        workspaceId: "workspace-id",
      }).children,
    ).toEqual([]);
    expect(
      filterJsTestExplorerTree(tree, "@openedFiles", {
        openedFilesSnapshot: {
          hadEditorResources: false,
          identities: [],
          root: currentFileIdentity("/other", "src/context.test.ts").root,
          truncated: false,
        },
        workspaceId: "workspace-id",
      }).children,
    ).toEqual([]);
    expect(filterJsTestExplorerTree(tree, "@openedFiles").children).toEqual([]);
  });

  it("matches opened-file aliases through authoritative case and Unicode identity policy", () => {
    const policy: WorkspacePathPolicy = {
      caseSensitive: false,
      foldCase: (value) => value.toLocaleLowerCase("en-US"),
      unicodeNormalization: "NFC",
    };
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [discovery("src/café.test.ts", ["payments"], "charges card", 4, "failed")],
      "workspace-id",
    );

    expect(
      filterJsTestExplorerTree(tree, "@openedFiles", {
        openedFilesSnapshot: openedFilesSnapshot([
          currentFileIdentity("/workspace", "SRC/cafe\u0301.TEST.TS", policy),
          currentFileIdentity("/workspace", "src/café.test.ts", policy),
        ]),
        workspaceId: "workspace-id",
      }).children,
    ).toHaveLength(1);
  });

  it("lets @openedFiles dominate @doc instead of intersecting their document projections", () => {
    const tree = buildJsTestExplorerTree(
      "/workspace",
      [
        discovery("src/payment.test.ts", ["payments"], "refunds card", 4, "failed"),
        discovery("src/user.test.ts", ["users"], "refunds user", 7, "failed"),
      ],
      "workspace-id",
    );
    const currentFile = currentFileIdentity("/workspace", "src/payment.test.ts");

    expect(
      filterJsTestExplorerTree(tree, "@doc @openedFiles", {
        currentFile,
        openedFilesSnapshot: openedFilesSnapshot([
          currentFileIdentity("/workspace", "src/payment.test.ts"),
          currentFileIdentity("/workspace", "src/user.test.ts"),
        ]),
        workspaceId: "workspace-id",
      }).children.map(({ filePath }) => filePath),
    ).toEqual(["src/payment.test.ts", "src/user.test.ts"]);
    expect(
      filterJsTestExplorerTree(tree, "@doc @openedFiles", {
        currentFile,
        openedFilesSnapshot: openedFilesSnapshot([
          currentFileIdentity("/workspace", "src/user.test.ts"),
        ]),
        workspaceId: "workspace-id",
      }).children.map(({ filePath }) => filePath),
    ).toEqual(["src/user.test.ts"]);
  });

  it("fails opened-file projection closed for foreign roots, owners, and malformed discoveries", () => {
    const identity = currentFileIdentity("/workspace-b", "src/a.test.ts");
    expect(
      filterJsTestExplorerTree(
        buildJsTestExplorerTree(
          "/workspace-a",
          [discovery("src/a.test.ts", ["suite"], "works", 4, "failed")],
          "workspace-id",
        ),
        "@openedFiles",
        { openedFilesSnapshot: openedFilesSnapshot([identity]), workspaceId: "workspace-id" },
      ).children,
    ).toEqual([]);
    expect(
      filterJsTestExplorerTree(
        buildJsTestExplorerTree(
          "/workspace-b",
          [discovery("src/./a.test.ts", ["suite"], "works", 4, "failed")],
          "workspace-id",
        ),
        "@openedFiles",
        { openedFilesSnapshot: openedFilesSnapshot([identity]), workspaceId: "workspace-id" },
      ).children,
    ).toEqual([]);
    expect(
      filterJsTestExplorerTree(
        buildJsTestExplorerTree(
          "/workspace-b",
          [discovery("src/a.test.ts", ["suite"], "works", 4, "failed")],
          "workspace-id",
        ),
        "@openedFiles",
        {
          openedFilesSnapshot: openedFilesSnapshot([identity]),
          workspaceId: "replacement-owner",
        },
      ).children,
    ).toEqual([]);
  });

  it("rejects a foreign tree root, workspace owner, and malformed discovery spelling", () => {
    const identity = currentFileIdentity("/workspace-b", "src/a.test.ts");
    const foreignTree = buildJsTestExplorerTree(
      "/workspace-a",
      [discovery("src/a.test.ts", ["suite"], "works", 4, "failed")],
      "workspace-id",
    );
    expect(
      filterJsTestExplorerTree(foreignTree, "@doc", {
        currentFile: identity,
        workspaceId: "workspace-id",
      }).children,
    ).toEqual([]);
    for (const malformedPath of [
      "src/./a.test.ts",
      "src//a.test.ts",
      "src\\a.test.ts",
      "src/a.test.ts/",
    ]) {
      expect(
        filterJsTestExplorerTree(
          buildJsTestExplorerTree(
            "/workspace-b",
            [discovery(malformedPath, ["suite"], "works", 4, "failed")],
            "workspace-id",
          ),
          "@doc",
          { currentFile: identity, workspaceId: "workspace-id" },
        ).children,
      ).toEqual([]);
    }
    expect(
      filterJsTestExplorerTree(
        buildJsTestExplorerTree(
          "/workspace-b",
          [discovery("src/a.test.ts", ["suite"], "works", 4, "failed")],
          "workspace-id",
        ),
        "@doc",
        { currentFile: identity, workspaceId: "replacement-owner" },
      ).children,
    ).toEqual([]);
    const replacementIdentity = currentFileIdentity(
      "/workspace-b",
      "src/a.test.ts",
      DEFAULT_WORKSPACE_PATH_POLICY,
      "replacement-owner",
    );
    expect(
      filterJsTestExplorerTree(
        buildJsTestExplorerTree(
          "/workspace-b",
          [discovery("src/a.test.ts", ["suite"], "works", 4, "failed")],
          "workspace-id",
        ),
        "@doc",
        { currentFile: replacementIdentity, workspaceId: "replacement-owner" },
      ).children,
    ).toEqual([]);
  });
});

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

function openedFilesSnapshot(
  identities: readonly JsTestExplorerCurrentFileIdentity[],
  overrides: Partial<
    Pick<JsTestExplorerOpenedFilesSnapshot, "hadEditorResources" | "truncated">
  > = {},
): JsTestExplorerOpenedFilesSnapshot {
  const root = identities[0]?.root ?? currentFileIdentity("/workspace", "src/context.test.ts").root;
  return {
    hadEditorResources: overrides.hadEditorResources ?? true,
    identities,
    root,
    truncated: overrides.truncated ?? false,
  };
}
