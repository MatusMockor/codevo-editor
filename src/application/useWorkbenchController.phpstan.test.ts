import { describe, expect, it, vi } from "vitest";
import {
  runPhpstanIgnoreAtCursor,
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
    replacePhpstanRetainedDiagnostics: vi.fn(),
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
    expect(input.replacePhpstanRetainedDiagnostics).not.toHaveBeenCalled();
    expect(input.setMessage).toHaveBeenLastCalledWith(null);
    expect(input.setRunning).toHaveBeenLastCalledWith(false);
  });

  it("retains successful diagnostics only after the awaited run remains current", async () => {
    const analysis = {
      status: "ok" as const,
      diagnostics: [
        {
          filePath: "src/A.php",
          line: 4,
          message: "Issue",
          identifier: "argument.type",
          ignorable: true,
        },
      ],
      totals: { fileErrors: 1, generalErrors: 0, fileCount: 1 },
    };
    const input = options(Promise.resolve(analysis));

    await runPhpstanWorkspaceAnalysis(input);

    expect(input.replacePhpstanRetainedDiagnostics).toHaveBeenCalledWith(
      "/workspace",
      analysis,
    );
  });
});

describe("runPhpstanIgnoreAtCursor", () => {
  const document = {
    path: "/workspace/src/A.php",
    name: "A.php",
    language: "php",
    content: "<?php\n    broken();\n",
    savedContent: "<?php\n    broken();\n",
  };

  it("combines unique identifiers on the cursor line and reports their count", () => {
    const runner = vi.fn(() => 2);
    const setMessage = vi.fn();

    expect(
      runPhpstanIgnoreAtCursor({
        currentRoot: "/workspace",
        requestedRoot: "/workspace",
        document,
        lineNumber: 2,
        diagnostics: [
          { line: 2, identifier: "argument.type" },
          { line: 2, identifier: "return.type" },
          { line: 2, identifier: "argument.type" },
        ],
        runner,
        setMessage,
        workspaceTrusted: true,
      }),
    ).toBe(2);
    expect(runner).toHaveBeenCalledWith(
      document.content,
      2,
      ["argument.type", "return.type"],
    );
    expect(setMessage).toHaveBeenCalledWith(
      "PHPStan: Ignored 2 issues (argument.type, return.type)",
    );
  });

  it.each([
    ["stale root", { currentRoot: "/other" }],
    ["untrusted workspace", { workspaceTrusted: false }],
    ["dirty document", { document: { ...document, content: "dirty" } }],
    ["no cursor diagnostic", { lineNumber: 3 }],
  ])("drops the action for a %s", (_label, overrides) => {
    const runner = vi.fn();
    runPhpstanIgnoreAtCursor({
      currentRoot: "/workspace",
      requestedRoot: "/workspace",
      document,
      lineNumber: 2,
      diagnostics: [{ line: 2, identifier: "argument.type" }],
      runner,
      setMessage: vi.fn(),
      workspaceTrusted: true,
      ...overrides,
    });
    expect(runner).not.toHaveBeenCalled();
  });
});
