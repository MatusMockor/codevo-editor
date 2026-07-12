import { describe, expect, it, vi } from "vitest";
import { TauriPhpstanDiagnosticsGateway } from "./tauriPhpstanDiagnosticsGateway";

describe("TauriPhpstanDiagnosticsGateway", () => {
  it("invokes the exact PHPStan command contract", async () => {
    const result = {
      status: "ok" as const,
      diagnostics: [],
      totals: { fileErrors: 0, generalErrors: 0, fileCount: 0 },
    };
    const invokeCommand = vi.fn(async () => result);
    const gateway = new TauriPhpstanDiagnosticsGateway(invokeCommand);

    await expect(
      gateway.analyse("/workspace", "/tools/phpstan", null),
    ).resolves.toBe(result);
    expect(invokeCommand).toHaveBeenCalledWith("run_phpstan_analysis", {
      rootPath: "/workspace",
      binaryPath: "/tools/phpstan",
      configPath: null,
    });
  });
});
