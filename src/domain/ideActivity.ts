import { shouldStartLanguageServer } from "./intelligence";
import type { LanguageServerPlan } from "./languageServer";
import {
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "./languageServerRuntime";
import { indexProgressPercent, type IndexProgressState } from "./indexProgress";
import type { IntelligenceMode } from "./workspace";
import { workspaceRootKeysEqual } from "./workspaceRootKey";

export type IdeActivityState = "active" | "idle" | "problem" | "scanning";

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
  workspaceRoot: string | null,
  phpRuntimeStatus: LanguageServerRuntimeStatus | null,
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null,
  indexProgress: IndexProgressState,
  languageServerLabel: string | null,
  frameworkActivityLabel: string | null,
): { label: string | null; state: IdeActivityState | null } {
  const runtimeLabel = compactLanguageServerActivityLabel(languageServerLabel);
  const labels = [
    runtimeLabel,
    runtimeLabel ? frameworkActivityLabel : null,
    compactIndexActivityLabel(indexProgress),
  ].filter((label): label is string => Boolean(label));
  if (labels.length === 0) return { label: null, state: null };
  return {
    label: `IDE: ${labels.join(" · ")}`,
    state: ideActivityState(
      workspaceRoot,
      phpRuntimeStatus,
      javaScriptTypeScriptRuntimeStatus,
      indexProgress,
    ),
  };
}

export function ideActivityState(
  workspaceRoot: string | null,
  phpRuntimeStatus: LanguageServerRuntimeStatus | null,
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null,
  indexProgress: IndexProgressState,
): IdeActivityState {
  const phpKind = runtimeStatusKindForWorkspace(phpRuntimeStatus, workspaceRoot);
  const tsKind = runtimeStatusKindForWorkspace(javaScriptTypeScriptRuntimeStatus, workspaceRoot);
  if (
    phpKind === "crashed" ||
    tsKind === "crashed" ||
    indexProgress.status === "failed" ||
    indexProgress.erroredEntries > 0
  )
    return "problem";
  if (phpKind === "starting" || tsKind === "starting" || indexProgress.status === "scanning")
    return "scanning";
  if (phpKind === "running" || tsKind === "running" || indexProgress.status === "completed")
    return "active";
  return "idle";
}

export function ideActivityDetail(
  workspaceRoot: string | null,
  phpRuntimeStatus: LanguageServerRuntimeStatus | null,
  javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null,
  indexProgress: IndexProgressState,
): string {
  return [
    `PHPactor: ${runtimeKindLabel(runtimeStatusKindForWorkspace(phpRuntimeStatus, workspaceRoot))}`,
    `TS Server: ${runtimeKindLabel(runtimeStatusKindForWorkspace(javaScriptTypeScriptRuntimeStatus, workspaceRoot))}`,
    `Index: ${indexDetailLabel(indexProgress, workspaceRoot)}`,
  ].join("\n");
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
  if (!status) return null;
  if (!workspaceRoot) return status.kind;
  return status.rootPath && workspaceRootKeysEqual(status.rootPath, workspaceRoot)
    ? status.kind
    : null;
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
