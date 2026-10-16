import { describe, expect, it } from "vitest";
import {
  createWorkspaceSessionOwnerKey,
  createLegacyWorkspaceSessionOwnerKey,
  resolveWorkspaceSessionOwnerKey,
} from "./workspaceSessionOwnerKey";

describe("workspaceSessionOwnerKey", () => {
  it("combines workspace identity with the normalized canonical root", () => {
    expect(createWorkspaceSessionOwnerKey("workspace-a", "/real/project/")).toBe(
      createWorkspaceSessionOwnerKey("workspace-a", "/real/project"),
    );
    expect(createWorkspaceSessionOwnerKey("workspace-a", "/real/project")).not.toBe(
      createWorkspaceSessionOwnerKey("workspace-b", "/real/project"),
    );
    expect(createWorkspaceSessionOwnerKey("workspace-a", "/real/project")).not.toBe(
      createWorkspaceSessionOwnerKey("workspace-a", "/other/project"),
    );
  });

  it("preserves normalized root ownership for legacy sessions", () => {
    expect(createLegacyWorkspaceSessionOwnerKey("/project/")).toBe(
      createLegacyWorkspaceSessionOwnerKey("/project"),
    );
  });

  it("falls back to legacy ownership for partial workspace descriptors", () => {
    expect(resolveWorkspaceSessionOwnerKey("/project", {})).toBe(
      createLegacyWorkspaceSessionOwnerKey("/project"),
    );
    expect(
      resolveWorkspaceSessionOwnerKey("/project", {
        canonicalRoot: "/canonical/project",
      }),
    ).toBe(createLegacyWorkspaceSessionOwnerKey("/project"));
  });
});
