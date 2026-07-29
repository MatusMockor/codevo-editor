import { describe, expect, it } from "vitest";
import {
  createDocumentSaveIdentity,
  createRegisteredDocumentSaveIdentity,
  documentSaveOwnershipKey,
  isRegisteredDocumentSaveIdentity,
  legacyDocumentSaveOwnership,
} from "./documentSaveIdentity";

describe("registered document save identity", () => {
  it("creates a closed immutable identity with explicit workspace ownership", () => {
    const identity = createRegisteredDocumentSaveIdentity(
      "workspace-1",
      "/real/workspace/",
      "src/App.ts",
    );

    expect(identity).toEqual({
      canonicalRoot: "/real/workspace",
      workspaceId: "workspace-1",
      workspaceRelativePath: "src/App.ts",
    });
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it.each(["", " workspace-1", "workspace-1 ", "workspace\0one", "\ud800"])(
    "rejects unsafe workspace ID %j",
    (workspaceId) => {
      expect(
        createRegisteredDocumentSaveIdentity(workspaceId, "/workspace", "src/App.ts"),
      ).toBeNull();
    },
  );

  it("keeps registered owners distinct even when canonical file paths match", () => {
    const first = createRegisteredDocumentSaveIdentity("workspace-1", "/workspace", "src/App.ts")!;
    const second = createRegisteredDocumentSaveIdentity("workspace-2", "/workspace", "src/App.ts")!;

    expect(documentSaveOwnershipKey(first)).not.toBe(documentSaveOwnershipKey(second));
  });

  it("recognizes only exact registered identity records", () => {
    const identity = createRegisteredDocumentSaveIdentity(
      "workspace-1",
      "/workspace",
      "src/App.ts",
    )!;

    expect(isRegisteredDocumentSaveIdentity(identity)).toBe(true);
    expect(isRegisteredDocumentSaveIdentity({ ...identity, extra: true })).toBe(false);
    expect(
      isRegisteredDocumentSaveIdentity(
        Object.defineProperty({}, "workspaceId", {
          enumerable: true,
          get: () => "workspace-1",
        }),
      ),
    ).toBe(false);
  });

  it("keeps legacy ownership structurally distinct from registered ownership", () => {
    const ownership = legacyDocumentSaveOwnership(
      "/selected/workspace",
      "/selected/workspace/src/App.ts",
    );

    expect(ownership).toEqual({
      path: "/selected/workspace/src/App.ts",
      rootPath: "/selected/workspace",
    });
    expect(Object.isFrozen(ownership)).toBe(true);
    expect("canonicalRoot" in ownership!).toBe(false);
    expect(
      documentSaveOwnershipKey(createDocumentSaveIdentity("/selected/workspace", "src/App.ts")!),
    ).toBe(documentSaveOwnershipKey(ownership!));
  });
});
