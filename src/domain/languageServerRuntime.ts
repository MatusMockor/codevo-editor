export type LanguageServerRuntimeStatus =
  | { kind: "starting"; sessionId: number }
  | { kind: "running"; sessionId: number }
  | { kind: "stopped" }
  | { kind: "crashed"; message: string };

export type UnsubscribeFn = () => void;

export interface LanguageServerRuntimeGateway {
  getStatus(): Promise<LanguageServerRuntimeStatus>;
  start(rootPath: string): Promise<LanguageServerRuntimeStatus>;
  stop(): Promise<LanguageServerRuntimeStatus>;
  subscribeStatus(
    listener: (status: LanguageServerRuntimeStatus) => void,
  ): Promise<UnsubscribeFn>;
}

export function languageServerStatusLabel(
  status: LanguageServerRuntimeStatus | null,
): string | null {
  if (!status) {
    return null;
  }

  if (status.kind === "starting") {
    return "PHPactor: starting";
  }

  if (status.kind === "running") {
    return "PHPactor: running";
  }

  if (status.kind === "crashed") {
    return "PHPactor: crashed";
  }

  return null;
}

export function languageServerCrashMessage(
  status: LanguageServerRuntimeStatus,
): string | null {
  if (status.kind !== "crashed") {
    return null;
  }

  return status.message;
}

export function isLanguageServerActive(
  status: LanguageServerRuntimeStatus | null,
): boolean {
  if (!status) {
    return false;
  }

  return status.kind === "starting" || status.kind === "running";
}
