import type { UnsubscribeFn } from "./languageServerRuntime";

export type LanguageRuntimeKind = "phpactor" | "tsserver";

export type RuntimeLifecycle =
  | "starting"
  | "running"
  | "stopped"
  | "crashed";

export interface RuntimeProcessStats {
  memoryKb?: number;
  cpuPercent?: number;
}

export interface RecentLspRequest {
  method: string;
  latencyMs: number;
  success: boolean;
}

export interface RuntimeObservability {
  kind: LanguageRuntimeKind;
  label: string;
  lifecycle: RuntimeLifecycle;
  pid?: number;
  crashReason?: string;
  stats?: RuntimeProcessStats;
  recentRequests?: RecentLspRequest[];
  stderrTail?: string[];
}

export interface RuntimeObservabilityReport {
  rootPath: string;
  runtimes: RuntimeObservability[];
}

export interface RuntimeObservabilityGateway {
  getObservability(rootPath: string): Promise<RuntimeObservabilityReport>;
  restart(
    rootPath: string,
    kind: LanguageRuntimeKind,
  ): Promise<void>;
  stop(rootPath: string, kind: LanguageRuntimeKind): Promise<void>;
  openLog(
    rootPath: string,
    kind: LanguageRuntimeKind,
  ): Promise<string | null>;
  subscribeStatus(listener: () => void): Promise<UnsubscribeFn>;
  /// Copy the pre-formatted debug bundle text to the system clipboard. The
  /// caller formats the bundle (so it stays testable); the gateway owns only the
  /// clipboard side effect.
  copyToClipboard(text: string): Promise<void>;
}

export function emptyRuntimeObservabilityReport(
  rootPath: string,
): RuntimeObservabilityReport {
  return { rootPath, runtimes: [] };
}

export function runtimeLifecycleLabel(lifecycle: RuntimeLifecycle): string {
  if (lifecycle === "starting") {
    return "Starting";
  }

  if (lifecycle === "running") {
    return "Running";
  }

  if (lifecycle === "crashed") {
    return "Crashed";
  }

  return "Stopped";
}

/// Indicator color token for the lifecycle dot. Green for live, red for
/// crashed, amber while starting, grey when stopped.
export function runtimeLifecycleTone(
  lifecycle: RuntimeLifecycle,
): "ok" | "warn" | "error" | "idle" {
  if (lifecycle === "running") {
    return "ok";
  }

  if (lifecycle === "starting") {
    return "warn";
  }

  if (lifecycle === "crashed") {
    return "error";
  }

  return "idle";
}

export function formatRuntimeMemory(memoryKb: number | undefined): string {
  if (memoryKb === undefined) {
    return "-";
  }

  if (memoryKb >= 1024 * 1024) {
    return `${(memoryKb / (1024 * 1024)).toFixed(1)} GB`;
  }

  if (memoryKb >= 1024) {
    return `${(memoryKb / 1024).toFixed(1)} MB`;
  }

  return `${memoryKb} KB`;
}

export function formatRuntimeCpu(cpuPercent: number | undefined): string {
  if (cpuPercent === undefined) {
    return "-";
  }

  return `${cpuPercent.toFixed(1)}%`;
}

export function canRestartRuntime(lifecycle: RuntimeLifecycle): boolean {
  return lifecycle !== "starting";
}

export function canStopRuntime(lifecycle: RuntimeLifecycle): boolean {
  return lifecycle === "running" || lifecycle === "starting";
}

export function formatRuntimeLatency(latencyMs: number): string {
  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(2)} s`;
  }

  return `${latencyMs} ms`;
}

function formatRequestLine(request: RecentLspRequest): string {
  const outcome = request.success ? "ok" : "error";

  return `- ${request.method} — ${formatRuntimeLatency(request.latencyMs)} (${outcome})`;
}

function formatRuntimeSection(runtime: RuntimeObservability): string {
  const lines = [
    `### ${runtime.label} (${runtime.kind})`,
    "",
    `- State: ${runtimeLifecycleLabel(runtime.lifecycle)}`,
    `- PID: ${runtime.pid ?? "-"}`,
    `- RAM: ${formatRuntimeMemory(runtime.stats?.memoryKb)}`,
    `- CPU: ${formatRuntimeCpu(runtime.stats?.cpuPercent)}`,
  ];

  if (runtime.crashReason) {
    lines.push(`- Crash reason: ${runtime.crashReason}`);
  }

  const recentRequests = runtime.recentRequests ?? [];
  lines.push("", "Recent LSP requests (newest first):");
  if (recentRequests.length === 0) {
    lines.push("- (none)");
  }
  recentRequests.forEach((request) => lines.push(formatRequestLine(request)));

  const stderrTail = runtime.stderrTail ?? [];
  lines.push("", "Stderr tail:");
  if (stderrTail.length === 0) {
    lines.push("```", "(empty)", "```");
    return lines.join("\n");
  }

  lines.push("```", ...stderrTail, "```");

  return lines.join("\n");
}

/// Build the structured, paste-ready markdown debug bundle for a workspace's
/// runtimes. Pure (no I/O) so it is fully unit-testable; the gateway copies the
/// returned string to the clipboard. Scoped to the report's own root so the
/// bundle never mixes another open project tab's runtimes.
export function formatRuntimeDebugBundle(
  report: RuntimeObservabilityReport,
  mode: string,
): string {
  const header = [
    "# Runtime debug bundle",
    "",
    `- Project: ${report.rootPath || "(none)"}`,
    `- Mode: ${mode}`,
    `- Runtimes: ${report.runtimes.length}`,
  ];

  if (report.runtimes.length === 0) {
    return [...header, "", "_No managed runtimes for this project._"].join("\n");
  }

  const sections = report.runtimes.map((runtime) =>
    formatRuntimeSection(runtime),
  );

  return [...header, "", ...sections].join("\n\n");
}
