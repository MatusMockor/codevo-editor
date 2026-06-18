import { describe, expect, it, vi } from "vitest";
import { TauriWorkspaceRuntimeLifecycleGateway } from "./tauriWorkspaceRuntimeLifecycleGateway";

type RuntimeLifecycleGatewayConstructor = ConstructorParameters<
  typeof TauriWorkspaceRuntimeLifecycleGateway
>;
type InvokeCommand = NonNullable<RuntimeLifecycleGatewayConstructor[0]>;

describe("TauriWorkspaceRuntimeLifecycleGateway", () => {
  it("keeps browser development runtime quiet outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriWorkspaceRuntimeLifecycleGateway(
      invokeCommand,
      () => false,
    );

    await expect(gateway.disposeWorkspace("/workspace")).resolves.toBeUndefined();

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates workspace runtime disposal inside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>(async () => undefined);
    const gateway = new TauriWorkspaceRuntimeLifecycleGateway(
      invokeCommand,
      () => true,
    );

    await expect(gateway.disposeWorkspace("/workspace")).resolves.toBeUndefined();

    expect(invokeCommand).toHaveBeenCalledWith("dispose_workspace_root", {
      rootPath: "/workspace",
    });
  });
});
