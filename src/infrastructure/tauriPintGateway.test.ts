import { describe, expect, it, vi } from "vitest";
import { TauriPintGateway } from "./tauriPintGateway";

describe("TauriPintGateway", () => {
  it("maps changed-files formatting to the exact Tauri contract", async () => {
    const result = { status: "ok" as const, changedFiles: 2 };
    const invokeCommand = vi.fn(async () => result);
    const gateway = new TauriPintGateway(invokeCommand);

    await expect(gateway.format("/workspace", null)).resolves.toBe(result);
    expect(invokeCommand).toHaveBeenCalledWith("run_pint_format", {
      rootPath: "/workspace",
      relativePath: null,
    });
  });

  it("passes an active file as one workspace-relative argument", async () => {
    const invokeCommand = vi.fn(async () => ({ status: "ok" }));
    const gateway = new TauriPintGateway(invokeCommand);

    await gateway.format("/workspace", "app/Models/User.php");

    expect(invokeCommand).toHaveBeenCalledWith("run_pint_format", {
      rootPath: "/workspace",
      relativePath: "app/Models/User.php",
    });
  });
});
