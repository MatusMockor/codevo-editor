import { describe, expect, it } from "vitest";
import {
  createEditorSessionOwnerKey,
  createLegacyEditorSessionOwnerKey,
  createWorkspaceEditorSessionOwnerKey,
} from "./editorSessionOwnerKey";

describe("editorSessionOwnerKey", () => {
  it("combines workspace identity with the normalized canonical root", () => {
    expect(createEditorSessionOwnerKey("workspace-a", "/real/project/"))
      .toBe(createEditorSessionOwnerKey("workspace-a", "/real/project"));
    expect(createEditorSessionOwnerKey("workspace-a", "/real/project"))
      .not.toBe(createEditorSessionOwnerKey("workspace-b", "/real/project"));
    expect(createEditorSessionOwnerKey("workspace-a", "/real/project"))
      .not.toBe(createEditorSessionOwnerKey("workspace-a", "/other/project"));
  });

  it("preserves normalized root ownership for legacy sessions", () => {
    expect(createLegacyEditorSessionOwnerKey("/project/"))
      .toBe(createLegacyEditorSessionOwnerKey("/project"));
  });

  it("falls back to legacy ownership for partial workspace descriptors", () => {
    expect(createWorkspaceEditorSessionOwnerKey("/project", {})).toBe(
      createLegacyEditorSessionOwnerKey("/project"),
    );
    expect(
      createWorkspaceEditorSessionOwnerKey("/project", {
        canonicalRoot: "/canonical/project",
      }),
    ).toBe(createLegacyEditorSessionOwnerKey("/project"));
  });
});
