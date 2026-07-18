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

  it("carries fix data from the Rust response", async () => {
    const result = {
      status: "ok" as const,
      diagnostics: [{
        filePath: "src/index.ts",
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 4,
        message: "Use const.",
        identifier: "prefer-const",
        severity: 2 as const,
        fix: { range: [0, 3] as [number, number], text: "const" },
      }],
      totals: { errorCount: 1, warningCount: 0, fileCount: 1 },
    };
    const gateway = new TauriEslintDiagnosticsGateway(vi.fn(async () => result));

    await expect(gateway.analyse("/workspace", null)).resolves.toEqual(result);
  });

  it("analyses the current unsaved document through the document command", async () => {
    const result = {
      status: "ok" as const,
      diagnostics: [],
      totals: { errorCount: 0, warningCount: 0, fileCount: 0 },
    };
    const invokeCommand = vi.fn(async () => result);
    const gateway = new TauriEslintDiagnosticsGateway(invokeCommand);

    await expect(
      gateway.analyseDocument(
        "/workspace-a",
        "/workspace-a/src/current.ts",
        "const dirty = true",
        "/workspace-a/tools/eslint",
      ),
    ).resolves.toBe(result);
    expect(invokeCommand).toHaveBeenCalledWith(
      "run_eslint_document_analysis",
      {
        rootPath: "/workspace-a",
        filePath: "/workspace-a/src/current.ts",
        content: "const dirty = true",
        binaryPath: "/workspace-a/tools/eslint",
      },
    );
  });
});
