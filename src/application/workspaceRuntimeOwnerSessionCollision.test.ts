import { describe, expect, it } from "vitest";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  isLanguageServerSessionActiveForOwner,
  isLanguageServerSessionCurrentForOwnerOrLegacy,
} from "./useWorkbenchController";

describe("workspace runtime owner session collisions", () => {
  it("rejects a colliding PHP session when the replacement owner has no cached runtime", () => {
    const root = "/workspace/shared-owner-root";
    const replaced = createWorkspaceRuntimeOwner("workspace-owner-a", root);
    const replacement = createWorkspaceRuntimeOwner("workspace-owner-b", root);
    const status = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running" as const,
      rootPath: root,
      sessionId: 701,
    };

    expect(
      isLanguageServerSessionCurrentForOwnerOrLegacy(
        { [replaced.ownerKey]: status },
        replacement,
        status,
        root,
        root,
        status.sessionId,
      ),
    ).toBe(false);
  });

  it("keeps the root-global session fallback for ownerless legacy workspaces", () => {
    const root = "/workspace/legacy-root";
    const status = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running" as const,
      rootPath: root,
      sessionId: 703,
    };

    expect(
      isLanguageServerSessionCurrentForOwnerOrLegacy(
        {},
        undefined,
        status,
        root,
        root,
        status.sessionId,
      ),
    ).toBe(true);
  });

  it("rejects a colliding TypeScript session when the replacement owner has no cached runtime", () => {
    const root = "/workspace/shared-typescript-owner-root";
    const replaced = createWorkspaceRuntimeOwner("typescript-owner-a", root);
    const replacement = createWorkspaceRuntimeOwner("typescript-owner-b", root);
    const status = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running" as const,
      rootPath: root,
      sessionId: 702,
    };

    expect(
      isLanguageServerSessionActiveForOwner(
        { [replaced.ownerKey]: status },
        replacement,
        root,
        status.sessionId,
      ),
    ).toBe(false);
  });
});
