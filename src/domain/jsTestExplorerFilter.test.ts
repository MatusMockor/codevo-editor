import { describe, expect, it } from "vitest";
import {
  MAX_JS_TEST_EXPLORER_FILTER_BYTES,
  MAX_JS_TEST_EXPLORER_OPENED_FILES,
  parseJsTestExplorerFilter,
  type JsTestExplorerCurrentFileIdentity,
  type JsTestExplorerOpenedFilesSnapshot,
} from "./jsTestExplorerFilter";
import { joinWorkspacePath } from "./workspace";
import {
  createWorkspaceRoot,
  DEFAULT_WORKSPACE_PATH_POLICY,
  parseWorkspacePath,
  type WorkspacePathPolicy,
} from "./workspacePath";

describe("JavaScript Test Explorer status filter", () => {
  it("parses the exact @failed token into an immutable status-only filter", () => {
    const filter = parseJsTestExplorerFilter("  @failed @failed  ");

    expect(filter).toEqual({
      kind: "valid",
      statusFilters: ["failed"],
      textQuery: "",
    });
    expect(Object.isFrozen(filter)).toBe(true);
    expect(filter.kind === "valid" && Object.isFrozen(filter.statusFilters)).toBe(true);
  });

  it("composes @failed with one normalized text query", () => {
    const filter = parseJsTestExplorerFilter("  Refunds   A Card  @failed ");

    expect(filter).toEqual({
      kind: "valid",
      statusFilters: ["failed"],
      textQuery: "refunds a card",
    });
  });

  it("parses exact @executed immutably and gives @failed priority independent of order", () => {
    const executed = parseJsTestExplorerFilter("  @executed @executed  ");

    expect(executed).toEqual({
      kind: "valid",
      statusFilters: ["executed"],
      textQuery: "",
    });
    expect(Object.isFrozen(executed)).toBe(true);
    expect(executed.kind === "valid" && Object.isFrozen(executed.statusFilters)).toBe(true);
    for (const query of ["@executed @failed", "@failed @executed"]) {
      expect(parseJsTestExplorerFilter(query)).toEqual({
        kind: "valid",
        statusFilters: ["failed"],
        textQuery: "",
      });
    }
  });

  it("composes exact @executed with text and Current File context", () => {
    const identity = currentFileIdentity("src/payment.test.ts");
    const filter = parseJsTestExplorerFilter("refund @executed @doc", {
      currentFile: identity,
      workspaceId: "workspace-id",
    });

    expect(filter).toMatchObject({
      currentFile: identity,
      kind: "valid",
      statusFilters: ["executed"],
      textQuery: "refund",
    });
  });

  it.each([
    ["email@failed", "email"],
    ["@failed,refund", "refund"],
    ["refund,@failed", "refund"],
  ])("extracts the known term from VS Code-style placement in %s", (query, textQuery) => {
    expect(parseJsTestExplorerFilter(query)).toEqual({
      kind: "valid",
      statusFilters: ["failed"],
      textQuery,
    });
  });

  it.each(["@Failed", "@failed-now", "@passed", "@", "@failed/refund"])(
    "keeps unsupported or inexact directive %s as ordinary text",
    (query) => {
      const filter = parseJsTestExplorerFilter(query);

      expect(filter).toEqual({ kind: "valid", statusFilters: [], textQuery: query.toLowerCase() });
      expect(Object.isFrozen(filter)).toBe(true);
    },
  );

  it.each(["@Executed", "@executed-now", "!@executed", "@executed/refund"])(
    "keeps inexact executed directive %s as ordinary text",
    (query) => {
      expect(parseJsTestExplorerFilter(query)).toEqual({
        kind: "valid",
        statusFilters: [],
        textQuery: query.toLowerCase(),
      });
    },
  );

  it("does not treat a Unicode-whitespace-suffixed term as @executed", () => {
    expect(parseJsTestExplorerFilter("@executed\u00a0refund")).toEqual({
      kind: "valid",
      statusFilters: [],
      textQuery: "@executed refund",
    });
  });

  it("does not treat a negated or Unicode-whitespace-suffixed term as @failed", () => {
    expect(parseJsTestExplorerFilter("!@failed")).toEqual({
      kind: "valid",
      statusFilters: [],
      textQuery: "!@failed",
    });
    expect(parseJsTestExplorerFilter("@failed\u00a0refund")).toEqual({
      kind: "valid",
      statusFilters: [],
      textQuery: "@failed refund",
    });
  });

  it("fails closed for malformed Unicode and oversized input", () => {
    expect(parseJsTestExplorerFilter("\ud800")).toEqual({
      kind: "invalid",
      reason: "invalid-unicode",
    });
    expect(parseJsTestExplorerFilter("x".repeat(MAX_JS_TEST_EXPLORER_FILTER_BYTES + 1))).toEqual({
      kind: "invalid",
      reason: "query-too-large",
    });
  });

  it("adds only an exact canonical Current File identity to the immutable filter", () => {
    const identity = currentFileIdentity("src/payment.test.ts");
    const filter = parseJsTestExplorerFilter("refund @doc @failed", {
      currentFile: identity,
      workspaceId: "workspace-id",
    });

    expect(filter).toMatchObject({
      kind: "valid",
      statusFilters: ["failed"],
      textQuery: "refund",
    });
    expect(filter.kind === "valid" && filter.currentFile).toBe(identity);
    expect(Object.isFrozen(filter)).toBe(true);
  });

  it("fails closed for absent, malformed, and internally inconsistent Current File identity", () => {
    const identity = currentFileIdentity("src/payment.test.ts");
    expect(parseJsTestExplorerFilter("@doc")).toEqual({
      kind: "invalid",
      reason: "current-file-unavailable",
    });
    expect(parseJsTestExplorerFilter("@doc", { currentFile: null })).toEqual({
      kind: "invalid",
      reason: "current-file-unavailable",
    });
    expect(
      parseJsTestExplorerFilter("@doc", {
        currentFile: { ...identity, relativeFilePath: "src/./payment.test.ts" },
        workspaceId: "workspace-id",
      }),
    ).toEqual({ kind: "invalid", reason: "invalid-current-file" });
    expect(
      parseJsTestExplorerFilter("@doc", {
        currentFile: { ...identity, pathKey: currentFileIdentity("src/other.test.ts").pathKey },
        workspaceId: "workspace-id",
      }),
    ).toEqual({ kind: "invalid", reason: "invalid-current-file" });
  });

  it("parses an immutable bounded @openedFiles snapshot and deduplicates canonical aliases", () => {
    const policy: WorkspacePathPolicy = {
      caseSensitive: false,
      foldCase: (value) => value.toLocaleLowerCase("en-US"),
      unicodeNormalization: "NFC",
    };
    const first = currentFileIdentity("src/café.test.ts", policy);
    const alias = currentFileIdentity("SRC/cafe\u0301.TEST.TS", policy);
    const second = currentFileIdentity("src/user.test.ts", policy);
    const filter = parseJsTestExplorerFilter("refund @openedFiles @failed", {
      openedFilesSnapshot: openedFilesSnapshot([first, alias, second]),
      workspaceId: "workspace-id",
    });
    const reversed = parseJsTestExplorerFilter("@openedFiles", {
      openedFilesSnapshot: openedFilesSnapshot([second, alias, first]),
      workspaceId: "workspace-id",
    });

    expect(filter).toMatchObject({
      kind: "valid",
      statusFilters: ["failed"],
      textQuery: "refund",
    });
    expect(
      filter.kind === "valid" &&
        filter.openedFilesSnapshot?.identities.map(({ pathKey }) => pathKey),
    ).toEqual([first.pathKey, second.pathKey]);
    expect(filter.kind === "valid" && Object.isFrozen(filter.openedFilesSnapshot)).toBe(true);
    expect(
      filter.kind === "valid" &&
        filter.openedFilesSnapshot?.identities.every((identity) => Object.isFrozen(identity)),
    ).toBe(true);
    expect(
      reversed.kind === "valid" &&
        reversed.openedFilesSnapshot?.identities.map(({ pathKey, relativeFilePath }) => ({
          pathKey,
          relativeFilePath,
        })),
    ).toEqual(
      filter.kind === "valid" &&
        filter.openedFilesSnapshot?.identities.map(({ pathKey, relativeFilePath }) => ({
          pathKey,
          relativeFilePath,
        })),
    );
  });

  it("distinguishes zero editor resources and zero owned identities from missing context", () => {
    const noResources = parseJsTestExplorerFilter("@openedFiles", {
      openedFilesSnapshot: openedFilesSnapshot([], { hadEditorResources: false }),
      workspaceId: "workspace-id",
    });
    expect(noResources).toMatchObject({
      kind: "valid",
      openedFilesSnapshot: { hadEditorResources: false, identities: [] },
      statusFilters: [],
      textQuery: "",
    });
    const noOwnedIdentities = parseJsTestExplorerFilter("@openedFiles", {
      openedFilesSnapshot: openedFilesSnapshot([], { hadEditorResources: true }),
      workspaceId: "workspace-id",
    });
    expect(noOwnedIdentities).toMatchObject({
      kind: "valid",
      openedFilesSnapshot: { hadEditorResources: true, identities: [] },
    });

    expect(parseJsTestExplorerFilter("@openedFiles")).toEqual({
      kind: "invalid",
      reason: "opened-files-unavailable",
    });
    expect(parseJsTestExplorerFilter("@openedFiles", { openedFilesSnapshot: null })).toEqual({
      kind: "invalid",
      reason: "opened-files-unavailable",
    });
  });

  it("fails opened-file context closed before processing over-cap or malformed snapshots", () => {
    const identity = currentFileIdentity("src/payment.test.ts");
    expect(
      parseJsTestExplorerFilter("@openedFiles", {
        openedFilesSnapshot: openedFilesSnapshot(
          Array.from({ length: MAX_JS_TEST_EXPLORER_OPENED_FILES + 1 }, () => identity),
        ),
        workspaceId: "workspace-id",
      }),
    ).toEqual({ kind: "invalid", reason: "opened-files-too-many" });
    expect(
      parseJsTestExplorerFilter("@openedFiles", {
        openedFilesSnapshot: openedFilesSnapshot([
          { ...identity, relativeFilePath: "src/./payment.test.ts" },
        ]),
        workspaceId: "workspace-id",
      }),
    ).toEqual({ kind: "invalid", reason: "invalid-opened-files" });
    expect(
      parseJsTestExplorerFilter("@openedFiles", {
        openedFilesSnapshot: openedFilesSnapshot([identity], { truncated: true }),
        workspaceId: "workspace-id",
      }),
    ).toEqual({ kind: "invalid", reason: "opened-files-too-many" });
  });

  it("lets @openedFiles dominate @doc without requiring or retaining Current File context", () => {
    const openedFile = currentFileIdentity("src/user.test.ts");
    const filter = parseJsTestExplorerFilter("@doc @openedFiles", {
      currentFile: null,
      openedFilesSnapshot: openedFilesSnapshot([openedFile]),
      workspaceId: "workspace-id",
    });

    expect(filter.kind).toBe("valid");
    expect(filter.kind === "valid" && filter.currentFile).toBeUndefined();
    expect(filter.kind === "valid" && filter.openedFilesSnapshot?.identities[0]?.pathKey).toBe(
      openedFile.pathKey,
    );
  });

  it("ignores document context until an exact lowercase document term is active", () => {
    const unavailable = { currentFile: null, openedFilesSnapshot: null } as const;

    expect(parseJsTestExplorerFilter("", unavailable)).toEqual({
      kind: "valid",
      statusFilters: [],
      textQuery: "",
    });
    expect(parseJsTestExplorerFilter("@OpenedFiles", unavailable)).toEqual({
      kind: "valid",
      statusFilters: [],
      textQuery: "@openedfiles",
    });
    expect(parseJsTestExplorerFilter("@DOC", unavailable)).toEqual({
      kind: "valid",
      statusFilters: [],
      textQuery: "@doc",
    });
  });
});

function currentFileIdentity(
  relativeFilePath: string,
  policy: WorkspacePathPolicy = DEFAULT_WORKSPACE_PATH_POLICY,
): JsTestExplorerCurrentFileIdentity {
  const root = createWorkspaceRoot("workspace-id", "/workspace", policy);
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
  const root = identities[0]?.root ?? currentFileIdentity("src/context.test.ts").root;
  return {
    hadEditorResources: overrides.hadEditorResources ?? true,
    identities,
    root,
    truncated: overrides.truncated ?? false,
  };
}
