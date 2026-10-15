import { describe, expect, it } from "vitest";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { WorkspaceRuntimeOwnerClaimRegistry } from "./workspaceRuntimeOwnerClaimRegistry";

describe("WorkspaceRuntimeOwnerClaimRegistry", () => {
  it("retires only the generation that still owns the claim", () => {
    const registry = new WorkspaceRuntimeOwnerClaimRegistry();
    const owner = createWorkspaceRuntimeOwner("owner", "/workspace");
    registry.register(owner, [], 2);

    expect(registry.retire(owner.ownerKey, 1)).toBeNull();
    expect(registry.retire(owner.ownerKey, 2)).toBe(owner);
    expect(registry.retire(owner.ownerKey)).toBeNull();
  });
});
