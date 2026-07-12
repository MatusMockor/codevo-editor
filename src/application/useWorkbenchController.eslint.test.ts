import { describe, expect, it, vi } from "vitest";
import type { EslintAnalysisResult } from "../domain/eslintDiagnostics";
import {
  runEslintWorkspaceAnalysis,
  type RunEslintWorkspaceAnalysisOptions,
} from "./useWorkbenchController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function options(
  resultPromise: Promise<EslintAnalysisResult>,
): RunEslintWorkspaceAnalysisOptions {
  return {
    rootPath: "/workspace",
    binaryPath: "/tools/eslint",
    currentWorkspaceRootRef: { current: "/workspace" },
    inFlightRef: { current: false },
    gateway: { analyse: vi.fn(() => resultPromise) },
    replaceEslintDiagnostics: vi.fn(),
    setMessage: vi.fn(),
    setRunning: vi.fn(),
  };
}

describe("runEslintWorkspaceAnalysis", () => {
  it("drops an auto-triggered run silently when analysis is already in flight", async () => {
    const input = options(Promise.resolve({ status: "unavailable" }));
    input.inFlightRef.current = true;

    await runEslintWorkspaceAnalysis({
      ...input,
      showStartMessage: false,
    });

    expect(input.gateway.analyse).not.toHaveBeenCalled();
    expect(input.setMessage).not.toHaveBeenCalled();
    expect(input.setRunning).not.toHaveBeenCalled();
  });

  it("suppresses the transient auto-run status while updating diagnostics normally", async () => {
    const result = deferred<EslintAnalysisResult>();
    const input = options(result.promise);
    const run = runEslintWorkspaceAnalysis({
      ...input,
      showStartMessage: false,
    });

    expect(input.setMessage).not.toHaveBeenCalledWith(
      "ESLint: Analysing workspace…",
    );
    result.resolve({
      status: "ok",
      diagnostics: [],
      totals: { errorCount: 0, warningCount: 0, fileCount: 1 },
    });
    await run;

    expect(input.replaceEslintDiagnostics).toHaveBeenCalledWith(
      "/workspace",
      [],
    );
    expect(input.setMessage).toHaveBeenLastCalledWith(
      "ESLint: 0 problems in 1 files",
    );
  });

  it("guards double runs and reports uncapped error plus warning totals", async () => {
    const result = deferred<EslintAnalysisResult>();
    const input = options(result.promise);
    const firstRun = runEslintWorkspaceAnalysis(input);
    const secondRun = runEslintWorkspaceAnalysis(input);

    expect(input.gateway.analyse).toHaveBeenCalledTimes(1);
    expect(input.gateway.analyse).toHaveBeenCalledWith(
      "/workspace",
      "/tools/eslint",
    );
    expect(input.setMessage).toHaveBeenCalledWith(
      "ESLint: Analysing workspace…",
    );

    result.resolve({
      status: "ok",
      diagnostics: [
        {
          filePath: "src/index.ts",
          line: 1,
          column: 1,
          endLine: null,
          endColumn: null,
          message: "Warning",
          identifier: "rule",
          severity: 1,
        },
      ],
      totals: { errorCount: 2, warningCount: 3, fileCount: 4 },
    });
    await Promise.all([firstRun, secondRun]);

    expect(input.replaceEslintDiagnostics).toHaveBeenCalledWith(
      "/workspace",
      expect.arrayContaining([
        expect.objectContaining({
          groupKey: "eslint:/workspace",
          severity: "warning",
        }),
      ]),
    );
    expect(input.setMessage).toHaveBeenLastCalledWith(
      "ESLint: 5 problems in 4 files",
    );
    expect(input.inFlightRef.current).toBe(false);
  });

  it("drops stale results and clears the stale message", async () => {
    const result = deferred<EslintAnalysisResult>();
    const input = options(result.promise);
    const run = runEslintWorkspaceAnalysis(input);
    input.currentWorkspaceRootRef.current = "/other";

    result.resolve({ status: "unavailable" });
    await run;

    expect(input.replaceEslintDiagnostics).not.toHaveBeenCalled();
    expect(input.setMessage).toHaveBeenLastCalledWith(null);
    expect(input.setRunning).toHaveBeenLastCalledWith(false);
  });
});
