import { describe, expect, it } from "vitest";
import { createWorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import {
  PHP_AUTOSTART_ATTEMPT_RETENTION_LIMIT,
  autostartLeaseCleanupAction,
  recordPhpAutostartAttempt,
} from "./runtimeAutostartAuthority";

describe("runtime autostart authority", () => {
  it("retains only the newest bounded PHP attempt owners deterministically", () => {
    const attemptsByOwner: Record<string, number> = {};
    const owners = Array.from({ length: PHP_AUTOSTART_ATTEMPT_RETENTION_LIMIT + 8 }, (_, index) =>
      createWorkspaceRuntimeOwner(`workspace-${index}`, `/workspace-${index}`),
    );

    owners.forEach((owner, index) => {
      recordPhpAutostartAttempt(attemptsByOwner, owner.ownerKey, index + 1);
    });

    expect(Object.keys(attemptsByOwner)).toEqual(
      owners.slice(-PHP_AUTOSTART_ATTEMPT_RETENTION_LIMIT).map((owner) => owner.ownerKey),
    );

    recordPhpAutostartAttempt(attemptsByOwner, owners[8].ownerKey, 99);
    const newestOwner = createWorkspaceRuntimeOwner("workspace-newest", "/workspace-newest");
    recordPhpAutostartAttempt(attemptsByOwner, newestOwner.ownerKey, 1);

    expect(Object.keys(attemptsByOwner)).toEqual([
      ...owners.slice(10).map((owner) => owner.ownerKey),
      owners[8].ownerKey,
      newestOwner.ownerKey,
    ]);
  });

  it("retains a pending lease only across an exact-owner alias transfer", () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", "/workspace-a");
    const sameGenerationAlias = createWorkspaceRuntimeOwner("workspace-a", "/alias/workspace-a");
    const replacement = createWorkspaceRuntimeOwner("workspace-a", "/workspace-a");
    const foreignOwner = createWorkspaceRuntimeOwner("workspace-b", "/workspace-b");

    expect(autostartLeaseCleanupAction(owner, owner)).toBe("cancel-retain");
    expect(autostartLeaseCleanupAction(owner, sameGenerationAlias)).toBe("retain");
    expect(autostartLeaseCleanupAction(owner, replacement)).toBe("cancel-release");
    expect(autostartLeaseCleanupAction(owner, foreignOwner)).toBe("cancel-release");
    expect(autostartLeaseCleanupAction(owner, null)).toBe("cancel-release");
  });
});
