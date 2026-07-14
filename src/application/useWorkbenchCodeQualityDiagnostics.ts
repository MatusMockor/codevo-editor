import {
  parseEslintDiagnostics,
  type EslintAnalysisResult,
  type EslintDiagnosticsGateway,
  type EslintFix,
} from "../domain/eslintDiagnostics";
import type { WorkbenchNotice } from "./workbenchNotice";
import {
  parsePhpstanDiagnostics,
  type PhpstanAnalysisResult,
  type PhpstanDiagnosticsGateway,
  type RetainedPhpstanDiagnostic,
} from "../domain/phpstanDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export type EditorSurfaceBufferFixRunner = (
  expectedContent: string,
  fixes: EslintFix[],
) => number | null;

export type EditorSurfacePhpstanIgnoreRunner = (
  expectedContent: string,
  lineNumber: number,
  identifiers: string[],
) => number | null;

export interface RunEslintWorkspaceAnalysisOptions {
  rootPath: string;
  binaryPath: string | null;
  currentWorkspaceRootRef: { current: string | null };
  inFlightRef: { current: boolean };
  gateway: EslintDiagnosticsGateway;
  replaceEslintDiagnostics(rootPath: string, notices: WorkbenchNotice[]): void;
  replaceEslintFixes?(rootPath: string, result: EslintAnalysisResult): void;
  replaceEslintRetainedDiagnostics?(
    rootPath: string,
    result: EslintAnalysisResult,
  ): void;
  showStartMessage?: boolean;
  setMessage(message: string | null): void;
  setRunning(running: boolean): void;
  workspaceTrusted?: boolean;
}

export async function runEslintWorkspaceAnalysis({
  rootPath,
  binaryPath,
  currentWorkspaceRootRef,
  inFlightRef,
  gateway,
  replaceEslintDiagnostics,
  replaceEslintFixes,
  replaceEslintRetainedDiagnostics,
  showStartMessage = true,
  setMessage,
  setRunning,
  workspaceTrusted = true,
}: RunEslintWorkspaceAnalysisOptions): Promise<void> {
  if (!showStartMessage && !workspaceTrusted) {
    return;
  }

  if (inFlightRef.current) {
    return;
  }

  inFlightRef.current = true;
  setRunning(true);
  if (showStartMessage) {
    setMessage("ESLint: Analysing workspace…");
  }

  try {
    let result;

    try {
      result = await gateway.analyse(rootPath, binaryPath);
    } catch (error) {
      result = {
        status: "error" as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
      setMessage(null);
      return;
    }

    replaceEslintFixes?.(rootPath, result);
    replaceEslintRetainedDiagnostics?.(rootPath, result);
    replaceEslintDiagnostics(rootPath, parseEslintDiagnostics(result, rootPath));

    if (result.status === "ok") {
      const problemCount = result.totals.errorCount + result.totals.warningCount;
      setMessage(
        `ESLint: ${problemCount} problems in ${result.totals.fileCount} files`,
      );
      return;
    }

    if (result.status === "unavailable") {
      setMessage(`ESLint: ${result.message ?? "unavailable"}`);
      return;
    }

    setMessage(`ESLint: ${result.message}`);
  } finally {
    inFlightRef.current = false;
    setRunning(false);
  }
}

export function runEslintFixAllInActiveFile({
  currentRoot,
  document,
  fixes,
  requestedRoot,
  runner,
  setMessage,
  workspaceTrusted,
}: {
  currentRoot: string | null;
  document: EditorDocument | null;
  fixes: readonly EslintFix[];
  requestedRoot: string | null;
  runner: EditorSurfaceBufferFixRunner | null;
  setMessage(message: string): void;
  workspaceTrusted: boolean;
}): number | null {
  if (!requestedRoot || !document || document.readOnly) {
    return null;
  }

  if (!workspaceTrusted) {
    return null;
  }

  if (!workspaceRootKeysEqual(currentRoot, requestedRoot)) {
    return null;
  }

  if (document.content !== document.savedContent || fixes.length === 0 || !runner) {
    return null;
  }

  const appliedCount = runner(document.content, [...fixes]);

  if (!appliedCount) {
    return appliedCount;
  }

  const noun = appliedCount === 1 ? "fix" : "fixes";
  setMessage(`ESLint: Applied ${appliedCount} ${noun}`);
  return appliedCount;
}

export interface RunPhpstanWorkspaceAnalysisOptions {
  rootPath: string;
  binaryPath: string | null;
  currentWorkspaceRootRef: { current: string | null };
  inFlightRef: { current: boolean };
  gateway: PhpstanDiagnosticsGateway;
  replacePhpstanDiagnostics(rootPath: string, notices: WorkbenchNotice[]): void;
  replacePhpstanRetainedDiagnostics?(
    rootPath: string,
    result: PhpstanAnalysisResult,
  ): void;
  showStartMessage?: boolean;
  setMessage(message: string | null): void;
  setRunning(running: boolean): void;
  workspaceTrusted?: boolean;
}

export async function runPhpstanWorkspaceAnalysis({
  rootPath,
  binaryPath,
  currentWorkspaceRootRef,
  inFlightRef,
  gateway,
  replacePhpstanDiagnostics,
  replacePhpstanRetainedDiagnostics,
  showStartMessage = true,
  setMessage,
  setRunning,
  workspaceTrusted = true,
}: RunPhpstanWorkspaceAnalysisOptions): Promise<void> {
  if (!showStartMessage && !workspaceTrusted) {
    return;
  }

  if (inFlightRef.current) {
    return;
  }

  inFlightRef.current = true;
  setRunning(true);
  if (showStartMessage) {
    setMessage("PHPStan: Analysing workspace…");
  }

  try {
    let result;

    try {
      result = await gateway.analyse(rootPath, binaryPath, null);
    } catch (error) {
      result = {
        status: "error" as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
      setMessage(null);
      return;
    }

    replacePhpstanRetainedDiagnostics?.(rootPath, result);
    replacePhpstanDiagnostics(
      rootPath,
      parsePhpstanDiagnostics(result, rootPath),
    );

    if (result.status === "ok") {
      const problemCount =
        result.totals.fileErrors + result.totals.generalErrors;
      setMessage(
        `PHPStan: ${problemCount} problems in ${result.totals.fileCount} files`,
      );
      return;
    }

    if (result.status === "unavailable") {
      setMessage(`PHPStan: ${result.message ?? "unavailable"}`);
      return;
    }

    setMessage(`PHPStan: ${result.message}`);
  } finally {
    inFlightRef.current = false;
    setRunning(false);
  }
}

export function runPhpstanIgnoreAtCursor({
  currentRoot,
  requestedRoot,
  document,
  lineNumber,
  diagnostics,
  runner,
  setMessage,
  workspaceTrusted,
}: {
  currentRoot: string | null;
  requestedRoot: string | null;
  document: EditorDocument | null;
  lineNumber: number;
  diagnostics: readonly RetainedPhpstanDiagnostic[];
  runner: EditorSurfacePhpstanIgnoreRunner | null;
  setMessage(message: string): void;
  workspaceTrusted: boolean;
}): number | null {
  if (!requestedRoot || !document || document.readOnly || !workspaceTrusted) {
    return null;
  }

  if (!workspaceRootKeysEqual(currentRoot, requestedRoot)) {
    return null;
  }

  if (document.content !== document.savedContent || !runner) {
    return null;
  }

  const identifiers = [
    ...new Set(
      diagnostics
        .filter((diagnostic) => diagnostic.line === lineNumber)
        .map((diagnostic) => diagnostic.identifier),
    ),
  ];

  if (identifiers.length === 0) {
    return null;
  }

  const appliedCount = runner(document.content, lineNumber, identifiers);

  if (!appliedCount) {
    return appliedCount;
  }

  const noun = appliedCount === 1 ? "issue" : "issues";
  setMessage(
    `PHPStan: Ignored ${appliedCount} ${noun} (${identifiers.join(", ")})`,
  );
  return appliedCount;
}
