import { shouldStartLanguageServer } from "./intelligence";
import type { LanguageServerPlan } from "./languageServer";
import {
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "./languageServerRuntime";
import { indexProgressPercent, type IndexProgressState } from "./indexProgress";
import type { IntelligenceMode } from "./workspace";
import { workspaceRootKeysEqual } from "./workspaceRootKey";

export type IdeActivitySummary =
  | { readonly kind: "busy"; readonly text: string }
  | { readonly kind: "problem"; readonly text: string; readonly reason: string | null };

export function phpLanguageServerActivityLabel(
  intelligenceMode: IntelligenceMode,
  runtimeStatus: LanguageServerRuntimeStatus | null,
  workspaceRoot: string | null,
  plan: LanguageServerPlan | null,
): string | null {
  if (!shouldStartLanguageServer(intelligenceMode)) return null;
  const runtimeLabel = languageServerStatusLabel(runtimeStatus, "PHPactor", { workspaceRoot });
  if (runtimeLabel) return runtimeLabel;
  return plan ? languageServerPlanLabel(plan) : null;
}

export function ideActivityStatus(
  indexProgress: IndexProgressState,
  languageServerLabel: string | null,
  frameworkActivityLabel: string | null,
): { label: string | null } {
  const runtimeLabel = compactLanguageServerActivityLabel(languageServerLabel);
  const labels = [
    runtimeLabel,
    runtimeLabel ? frameworkActivityLabel : null,
    compactIndexActivityLabel(indexProgress),
  ].filter((label): label is string => Boolean(label));
  if (labels.length === 0) return { label: null };
  return { label: `IDE: ${labels.join(" · ")}` };
}

export function ideActivityDetail(
  workspaceRoot: string | null,
  phpRuntimeStatus: LanguageServerRuntimeStatus | null,
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null,
  indexProgress: IndexProgressState,
): string {
  return [
    `PHPactor: ${runtimeKindLabel(runtimeStatusKindForWorkspace(phpRuntimeStatus, workspaceRoot))}`,
    `TypeScript: ${runtimeKindLabel(runtimeStatusKindForWorkspace(javaScriptTypeScriptRuntimeStatus, workspaceRoot))}`,
    `Index: ${indexDetailLabel(indexProgress, workspaceRoot)}`,
  ].join("\n");
}

export function ideActivitySummary(
  workspaceRoot: string | null,
  phpRuntimeStatus: LanguageServerRuntimeStatus | null,
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null,
  indexProgress: IndexProgressState,
): IdeActivitySummary | null {
  const typeScript = runtimeStatusForWorkspace(javaScriptTypeScriptRuntimeStatus, workspaceRoot);
  const php = runtimeStatusForWorkspace(phpRuntimeStatus, workspaceRoot);
  const index = indexProgressForWorkspace(indexProgress, workspaceRoot);
  return (
    runtimeProblem(typeScript, "TypeScript") ??
    runtimeProblem(php, "PHPactor") ??
    indexProblem(index) ??
    runtimeBusy(typeScript, "TypeScript") ??
    runtimeBusy(php, "PHPactor") ??
    indexBusy(index)
  );
}

function runtimeProblem(
  status: LanguageServerRuntimeStatus | null,
  name: string,
): IdeActivitySummary | null {
  if (status?.kind !== "crashed") return null;
  return { kind: "problem", text: `${name} crashed`, reason: status.message || null };
}

function indexProgressForWorkspace(
  progress: IndexProgressState,
  workspaceRoot: string | null,
): IndexProgressState | null {
  if (!progress.rootPath || !workspaceRoot) return null;
  return workspaceRootKeysEqual(progress.rootPath, workspaceRoot) ? progress : null;
}

function indexProblem(progress: IndexProgressState | null): IdeActivitySummary | null {
  if (progress === null) return null;
  if (progress.status === "failed") {
    return { kind: "problem", text: "Indexing failed", reason: progress.message || null };
  }
  if (progress.erroredEntries <= 0) return null;
  const files = progress.erroredEntries === 1 ? "file" : "files";
  return { kind: "problem", text: `${progress.erroredEntries} ${files} not indexed`, reason: null };
}

function runtimeBusy(
  status: LanguageServerRuntimeStatus | null,
  name: string,
): IdeActivitySummary | null {
  if (status?.kind !== "starting") return null;
  return { kind: "busy", text: `Starting ${name}…` };
}

function indexBusy(progress: IndexProgressState | null): IdeActivitySummary | null {
  if (progress?.status !== "scanning") return null;
  if (progress.totalFiles === null || progress.totalFiles <= 0) {
    return { kind: "busy", text: "Indexing…" };
  }
  return { kind: "busy", text: `Indexing ${indexProgressPercent(progress)}%…` };
}

function compactLanguageServerActivityLabel(label: string | null): string | null {
  return label?.replace(/PHPactor:/g, "PHPactor").replace(/TS Server:/g, "TS Server") ?? null;
}

function compactIndexActivityLabel(progress: IndexProgressState): string | null {
  if (progress.status === "idle") return null;
  if (progress.status === "scanning") return compactIndexScanningLabel(progress);
  if (progress.status === "failed") return "Index failed";
  const suffix = progress.erroredEntries > 0 ? ` · ${progress.erroredEntries} errors` : "";
  return `Index ${progress.indexedFiles} files${suffix}`;
}

function compactIndexScanningLabel(progress: IndexProgressState): string {
  if (progress.totalFiles !== null && progress.totalFiles > 0) {
    return `Indexing ${progress.processedFiles} of ${progress.totalFiles} (${indexProgressPercent(progress)}%)`;
  }
  return progress.processedFiles > 0
    ? `Indexing ${progress.processedFiles} files`
    : "Index scanning";
}

function runtimeKindLabel(kind: LanguageServerRuntimeStatus["kind"] | null): string {
  return kind === "starting" || kind === "running" || kind === "crashed" ? kind : "stopped";
}

function indexDetailLabel(progress: IndexProgressState, workspaceRoot: string | null): string {
  if (!progress.rootPath || !workspaceRootKeysEqual(progress.rootPath, workspaceRoot ?? ""))
    return "idle";
  if (progress.status === "idle" || progress.status === "failed" || progress.status === "completed")
    return progress.status;
  if (progress.totalFiles !== null && progress.totalFiles > 0) {
    return `${progress.processedFiles} of ${progress.totalFiles} (${indexProgressPercent(progress)}%)`;
  }
  return progress.processedFiles > 0 ? `${progress.processedFiles} files` : "scanning";
}

function runtimeStatusKindForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  workspaceRoot: string | null,
): LanguageServerRuntimeStatus["kind"] | null {
  return runtimeStatusForWorkspace(status, workspaceRoot)?.kind ?? null;
}

function runtimeStatusForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  workspaceRoot: string | null,
): LanguageServerRuntimeStatus | null {
  if (!status) return null;
  if (!workspaceRoot) return status;
  return status.rootPath && workspaceRootKeysEqual(status.rootPath, workspaceRoot) ? status : null;
}

function languageServerPlanLabel(plan: LanguageServerPlan): string {
  if (plan.status === "ready") return "PHP IDE engine ready";
  const prefix = plan.status === "blocked" ? "LSP blocked" : "LSP unavailable";
  return `${prefix} · ${languageServerPlanReason(plan.message)}`;
}

function languageServerPlanReason(message: string): string {
  if (
    message.includes("PHPactor was not found") ||
    message.includes("Managed PHP IDE engine was not found")
  )
    return "IDE engine missing";
  if (message.includes("not a PHP Composer project")) return "Not PHP Composer";
  if (message.includes("Trust this workspace")) return "Trust required";
  return message;
}
