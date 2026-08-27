import { describe, expect, it, vi } from "vitest";
import {
  parseRegisteredWorkspaceRuntimeDisposalResult,
  TauriWorkspaceRuntimeLifecycleGateway,
} from "./tauriWorkspaceRuntimeLifecycleGateway";

type RuntimeLifecycleGatewayConstructor = ConstructorParameters<
  typeof TauriWorkspaceRuntimeLifecycleGateway
>;
type InvokeCommand = NonNullable<RuntimeLifecycleGatewayConstructor[0]>;

describe("TauriWorkspaceRuntimeLifecycleGateway", () => {
  const registeredTarget = {
    workspaceId: "ws-a",
    admissionToken: 7,
    selectedRootPath: "/workspace-alias",
    canonicalRootPath: "/workspace-real",
  } as const;

  it("keeps browser development runtime quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriWorkspaceRuntimeLifecycleGateway(invokeCommand, () => false);

    await expect(gateway.disposeWorkspace("/workspace")).resolves.toBeUndefined();

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates workspace runtime disposal inside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => undefined);
    const gateway = new TauriWorkspaceRuntimeLifecycleGateway(invokeCommand, () => true);

    await expect(gateway.disposeWorkspace("/workspace")).resolves.toBeUndefined();

    expect(invokeCommand).toHaveBeenCalledWith("dispose_workspace_root", {
      rootPath: "/workspace",
    });
  });

  it("sends the exact registered descriptor and parses a closed result", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => ({ status: "closed" }));
    const gateway = new TauriWorkspaceRuntimeLifecycleGateway(invokeCommand, () => true);

    await expect(gateway.disposeRegisteredWorkspace(registeredTarget)).resolves.toEqual({
      status: "closed",
    });

    expect(invokeCommand).toHaveBeenCalledWith("dispose_registered_workspace", {
      request: registeredTarget,
    });
  });

  it("keeps registered disposal quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriWorkspaceRuntimeLifecycleGateway(invokeCommand, () => false);

    await expect(gateway.disposeRegisteredWorkspace(registeredTarget)).resolves.toEqual({
      status: "closed",
    });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("parses bounded incomplete errors and rejects open or malformed wire results", () => {
    expect(
      parseRegisteredWorkspaceRuntimeDisposalResult({
        status: "incomplete",
        errors: ["terminal cleanup failed"],
      }),
    ).toEqual({ status: "incomplete", errors: ["terminal cleanup failed"] });
    expect(() =>
      parseRegisteredWorkspaceRuntimeDisposalResult({ status: "closed", extra: true }),
    ).toThrow("Invalid closed workspace runtime disposal result");
    expect(() =>
      parseRegisteredWorkspaceRuntimeDisposalResult({ status: "future", errors: [] }),
    ).toThrow("unsupported status");
    expect(() =>
      parseRegisteredWorkspaceRuntimeDisposalResult({
        status: "incomplete",
        errors: Array.from({ length: 17 }, () => "error"),
      }),
    ).toThrow("invalid bounded errors");
    expect(() =>
      parseRegisteredWorkspaceRuntimeDisposalResult({ status: "incomplete", errors: [] }),
    ).toThrow("invalid bounded errors");
  });

  it("rejects invalid exact targets before transport", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriWorkspaceRuntimeLifecycleGateway(invokeCommand, () => true);

    await expect(
      gateway.disposeRegisteredWorkspace({ ...registeredTarget, admissionToken: 0 }),
    ).rejects.toThrow("admission token");
    await expect(
      gateway.disposeRegisteredWorkspace({
        ...registeredTarget,
        selectedRootPath: "relative/selected",
      }),
    ).rejects.toThrow("Selected workspace root must be absolute");
    await expect(
      gateway.disposeRegisteredWorkspace({
        ...registeredTarget,
        canonicalRootPath: "relative/canonical",
      }),
    ).rejects.toThrow("Canonical workspace root must be absolute");
    const openTarget = { ...registeredTarget, extra: true };
    await expect(gateway.disposeRegisteredWorkspace(openTarget)).rejects.toThrow(
      "Invalid registered workspace runtime disposal target",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
