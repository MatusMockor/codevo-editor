import { describe, expect, it, vi } from "vitest";
import { TauriEslintDiagnosticsGateway } from "./tauriEslintDiagnosticsGateway";

describe("TauriEslintDiagnosticsGateway", () => {
  it("invokes the exact ESLint command contract", async () => {
    const result = {
      status: "ok" as const,
      diagnostics: [],
      totals: { errorCount: 0, warningCount: 0, fileCount: 0 },
    };
    const invokeCommand = vi.fn(async () => result);
    const gateway = new TauriEslintDiagnosticsGateway(invokeCommand);

    await expect(gateway.analyse("/workspace", "/tools/eslint")).resolves.toBe(result);
    expect(invokeCommand).toHaveBeenCalledWith("run_eslint_analysis", {
      rootPath: "/workspace",
      binaryPath: "/tools/eslint",
    });
  });
});
