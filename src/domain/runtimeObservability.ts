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

export interface RuntimeObservability {
  kind: LanguageRuntimeKind;
  label: string;
  lifecycle: RuntimeLifecycle;
  pid?: number;
  crashReason?: string;
  stats?: RuntimeProcessStats;
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
