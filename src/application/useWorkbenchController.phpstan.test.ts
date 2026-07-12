import { describe, expect, it, vi } from "vitest";
import {
  runPhpstanWorkspaceAnalysis,
  type RunPhpstanWorkspaceAnalysisOptions,
} from "./useWorkbenchController";
import type { PhpstanAnalysisResult } from "../domain/phpstanDiagnostics";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function options(
  resultPromise: Promise<PhpstanAnalysisResult>,
): RunPhpstanWorkspaceAnalysisOptions {
  return {
    rootPath: "/workspace",
    binaryPath: "/tools/phpstan",
    currentWorkspaceRootRef: { current: "/workspace" },
    inFlightRef: { current: false },
    gateway: { analyse: vi.fn(() => resultPromise) },
    replacePhpstanDiagnostics: vi.fn(),
    setMessage: vi.fn(),
    setRunning: vi.fn(),
  };
}

describe("runPhpstanWorkspaceAnalysis", () => {
  it("drops an auto-triggered run silently when analysis is already in flight", async () => {
    const input = options(Promise.resolve({ status: "unavailable" }));
    input.inFlightRef.current = true;

    await runPhpstanWorkspaceAnalysis({
      ...input,
      showStartMessage: false,
    });

    expect(input.gateway.analyse).not.toHaveBeenCalled();
    expect(input.setMessage).not.toHaveBeenCalled();
    expect(input.setRunning).not.toHaveBeenCalled();
  });

  it("skips an auto-triggered run when the workspace is untrusted", async () => {
    const input = options(Promise.resolve({ status: "unavailable" }));

    await runPhpstanWorkspaceAnalysis({
      ...input,
      showStartMessage: false,
      workspaceTrusted: false,
    });

    expect(input.gateway.analyse).not.toHaveBeenCalled();
    expect(input.setMessage).not.toHaveBeenCalled();
    expect(input.setRunning).not.toHaveBeenCalled();
  });

  it("surfaces the workspace trust notice for a manual run", async () => {
    const input = options(
      Promise.resolve({
        status: "unavailable",
        message: "Trust this workspace to run PHPStan.",
      }),
    );

    await runPhpstanWorkspaceAnalysis({
      ...input,
      workspaceTrusted: false,
    });

    expect(input.gateway.analyse).toHaveBeenCalledOnce();
    expect(input.replacePhpstanDiagnostics).toHaveBeenCalledWith(
      "/workspace",
      [
        expect.objectContaining({
          message: "Trust this workspace to run PHPStan.",
          severity: "info",
        }),
      ],
    );
    expect(input.setMessage).toHaveBeenLastCalledWith(
      "PHPStan: Trust this workspace to run PHPStan.",
    );
  });

  it("suppresses the transient auto-run status while updating diagnostics normally", async () => {
    const result = deferred<PhpstanAnalysisResult>();
    const input = options(result.promise);
    const run = runPhpstanWorkspaceAnalysis({
      ...input,
      showStartMessage: false,
    });

    expect(input.setMessage).not.toHaveBeenCalledWith(
      "PHPStan: Analysing workspace…",
    );
    result.resolve({
      status: "ok",
      diagnostics: [],
      totals: { fileErrors: 0, generalErrors: 0, fileCount: 1 },
    });
    await run;

    expect(input.replacePhpstanDiagnostics).toHaveBeenCalledWith(
      "/workspace",
      [],
    );
    expect(input.setMessage).toHaveBeenLastCalledWith(
      "PHPStan: 0 problems in 1 files",
    );
  });

  it("guards double runs, invokes the configured binary, and reports a summary", async () => {
    const result = deferred<PhpstanAnalysisResult>();
    const input = options(result.promise);

    const firstRun = runPhpstanWorkspaceAnalysis(input);
    const secondRun = runPhpstanWorkspaceAnalysis(input);

    expect(input.gateway.analyse).toHaveBeenCalledTimes(1);
    expect(input.gateway.analyse).toHaveBeenCalledWith(
      "/workspace",
      "/tools/phpstan",
      null,
    );
    expect(input.setMessage).toHaveBeenCalledWith(
      "PHPStan: Analysing workspace…",
    );

    result.resolve({
      status: "ok",
      diagnostics: [
        {
          filePath: "src/A.php",
          line: 2,
          message: "A",
          identifier: null,
          ignorable: true,
        },
        {
          filePath: "src/A.php",
          line: 3,
          message: "B",
          identifier: null,
          ignorable: true,
        },
        {
          filePath: "",
          line: null,
          message: "General",
          identifier: null,
          ignorable: false,
        },
      ],
      totals: { fileErrors: 2, generalErrors: 1, fileCount: 9 },
    });
    await Promise.all([firstRun, secondRun]);

    expect(input.replacePhpstanDiagnostics).toHaveBeenCalledWith(
      "/workspace",
      expect.arrayContaining([
        expect.objectContaining({ groupKey: "phpstan:/workspace" }),
      ]),
    );
    expect(input.setMessage).toHaveBeenLastCalledWith(
      "PHPStan: 3 problems in 9 files",
    );
    expect(input.inFlightRef.current).toBe(false);
  });

  it("drops results after the active root changes", async () => {
    const result = deferred<PhpstanAnalysisResult>();
    const input = options(result.promise);
    const run = runPhpstanWorkspaceAnalysis(input);
    input.currentWorkspaceRootRef.current = "/other";

    result.resolve({ status: "unavailable" });
    await run;

    expect(input.replacePhpstanDiagnostics).not.toHaveBeenCalled();
    expect(input.setMessage).toHaveBeenLastCalledWith(null);
    expect(input.setRunning).toHaveBeenLastCalledWith(false);
  });
});
