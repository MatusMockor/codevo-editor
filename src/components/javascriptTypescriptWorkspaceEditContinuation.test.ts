import { describe, expect, it, vi } from "vitest";
import {
  consumeJavaScriptTypeScriptWorkspaceEditCommitReceipt,
  createJavaScriptTypeScriptWorkspaceEditCommitReceipt,
  isJavaScriptTypeScriptWorkspaceEditCommitReceiptActive,
} from "./javascriptTypescriptWorkspaceEditContinuation";

const ownerIdentity = Object.freeze({});

describe("JavaScript/TypeScript workspace edit continuation", () => {
  it("creates and consumes an exact commit receipt once", () => {
    const model = textModel("own edit", 8);
    const receipt = createJavaScriptTypeScriptWorkspaceEditCommitReceipt(
      { model: model as any, path: "/project/src/user.ts" },
      "/project/src/user.ts",
      11,
      ownerIdentity,
      commit("own edit", 8),
    );

    expect(receipt).not.toBeNull();
    expect(
      consumeJavaScriptTypeScriptWorkspaceEditCommitReceipt(
        receipt!,
        12,
        ownerIdentity,
        () => true,
      ),
    ).toBe(true);
    expect(
      consumeJavaScriptTypeScriptWorkspaceEditCommitReceipt(
        receipt!,
        12,
        ownerIdentity,
        () => true,
      ),
    ).toBe(false);
  });

  it("rejects a foreign same-model revision after the commit", () => {
    const model = textModel("own edit", 8);
    const receipt = createJavaScriptTypeScriptWorkspaceEditCommitReceipt(
      { model: model as any, path: "/project/src/user.ts" },
      "/project/src/user.ts",
      11,
      ownerIdentity,
      commit("own edit", 8),
    )!;

    model.setSnapshot("foreign edit", 9);

    expect(
      isJavaScriptTypeScriptWorkspaceEditCommitReceiptActive(
        receipt,
        12,
        ownerIdentity,
        () => true,
      ),
    ).toBe(false);
  });

  it("rejects an A-B-A owner epoch transition", () => {
    const model = textModel("own edit", 8);
    const receipt = createJavaScriptTypeScriptWorkspaceEditCommitReceipt(
      { model: model as any, path: "/project/src/user.ts" },
      "/project/src/user.ts",
      11,
      ownerIdentity,
      commit("own edit", 8),
    )!;

    expect(
      isJavaScriptTypeScriptWorkspaceEditCommitReceiptActive(
        receipt,
        13,
        ownerIdentity,
        () => true,
      ),
    ).toBe(false);
  });

  it("rejects a single foreign owner transition with an otherwise exact snapshot", () => {
    const model = textModel("own edit", 8);
    const receipt = createJavaScriptTypeScriptWorkspaceEditCommitReceipt(
      { model: model as any, path: "/project/src/user.ts" },
      "/project/src/user.ts",
      11,
      ownerIdentity,
      commit("own edit", 8),
    )!;

    expect(
      isJavaScriptTypeScriptWorkspaceEditCommitReceiptActive(
        receipt,
        12,
        Object.freeze({}),
        () => true,
      ),
    ).toBe(false);
  });

  it("fails closed when the commit does not contain exactly the authorized document", () => {
    const model = textModel("own edit", 8);
    const result = createJavaScriptTypeScriptWorkspaceEditCommitReceipt(
      { model: model as any, path: "/project/src/user.ts" },
      "/project/src/user.ts",
      11,
      ownerIdentity,
      {
        documents: [
          ...commit("own edit", 8).documents,
          { content: "other", path: "/project/src/other.ts", versionId: 2 },
        ],
        kind: "applied",
      },
    );

    expect(result).toBeNull();
  });
});

function commit(content: string, versionId: number) {
  return {
    documents: [{ content, path: "/project/src/user.ts", versionId }],
    kind: "applied" as const,
  };
}

function textModel(initialContent: string, initialVersion: number) {
  let content = initialContent;
  let version = initialVersion;
  return {
    getValue: vi.fn(() => content),
    getVersionId: vi.fn(() => version),
    setSnapshot(nextContent: string, nextVersion: number) {
      content = nextContent;
      version = nextVersion;
    },
  };
}
