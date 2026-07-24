import { describe, expect, it } from "vitest";
import type { LanguageServerDiagnosticEvent } from "../domain/languageServerDiagnostics";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { WorkspaceRuntimeOwnerClaimRegistry } from "./workspaceRuntimeOwnerClaimRegistry";

const event = (rootPath: string, sessionId: number): LanguageServerDiagnosticEvent => ({
  diagnostics: [],
  rootPath,
  sessionId,
  uri: `file://${rootPath}/index.php`,
  version: null,
});

const running = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
  kind: "starting",
  rootPath,
  sessionId,
});

describe("WorkspaceRuntimeOwnerClaimRegistry", () => {
  it("routes a shared alias to the owner whose runtime session emitted the event", () => {
    const registry = new WorkspaceRuntimeOwnerClaimRegistry();
    const first = createWorkspaceRuntimeOwner("first", "/workspace/alias");
    const second = createWorkspaceRuntimeOwner("second", "/workspace/alias");
    registry.register(first, ["/workspace/canonical"], 1);
    registry.register(second, ["/workspace/canonical"], 1);

    expect(
      registry.resolveDiagnosticsEvent(
        event("/workspace/canonical", 22),
        "php",
        {
          [first.ownerKey]: running(first.executionRoot, 11),
          [second.ownerKey]: running(second.executionRoot, 22),
        },
        {},
      ),
    ).toBe(second);
  });

  it("accepts a unique claim before its runtime status is published", () => {
    const registry = new WorkspaceRuntimeOwnerClaimRegistry();
    const owner = createWorkspaceRuntimeOwner("owner", "/workspace");
    registry.register(owner, ["/workspace-link"], 1);

    expect(
      registry.resolveDiagnosticsEvent(event("/workspace-link", 7), "typescript", {}, {}),
    ).toBe(owner);
  });

  it("does not guess when a known unique claim has a different live session", () => {
    const registry = new WorkspaceRuntimeOwnerClaimRegistry();
    const owner = createWorkspaceRuntimeOwner("owner", "/workspace");
    registry.register(owner, [], 1);

    expect(
      registry.resolveDiagnosticsEvent(
        event("/workspace", 7),
        "php",
        {
          [owner.ownerKey]: running(owner.executionRoot, 8),
        },
        {},
      ),
    ).toBeNull();
  });

  it("retires only the generation that still owns the claim", () => {
    const registry = new WorkspaceRuntimeOwnerClaimRegistry();
    const owner = createWorkspaceRuntimeOwner("owner", "/workspace");
    registry.register(owner, [], 2);

    expect(registry.retire(owner.ownerKey, 1)).toBeNull();
    expect(registry.retire(owner.ownerKey, 2)).toBe(owner);
    expect(registry.retire(owner.ownerKey)).toBeNull();
  });
});
