import { describe, expect, it, vi } from "vitest";
import { TauriPackageOperationsGateway } from "./tauriPackageOperationsGateway";

describe("TauriPackageOperationsGateway", () => {
  it("delegates preview and run through their named typed commands", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        manager: "npm",
        arguments: ["outdated"],
        description: "Check outdated packages.",
        mutatesManifest: false,
      })
      .mockResolvedValueOnce({ status: "ok", message: "Up to date.", manifestChanged: false });
    const gateway = new TauriPackageOperationsGateway(invoke);
    const request = { workspaceId: "workspace-1", operation: "outdated" as const };

    await expect(gateway.previewPackageOperation(request)).resolves.toMatchObject({
      manager: "npm",
    });
    await expect(gateway.runPackageOperation(request)).resolves.toEqual({
      status: "ok",
      message: "Up to date.",
      manifestChanged: false,
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "preview_workspace_package_operation",
      "run_workspace_package_operation",
    ]);
  });
});
