import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnsubscribeFn } from "../domain/languageServerRuntime";
import {
  emptyRuntimeObservabilityReport,
  type LanguageRuntimeKind,
  type RuntimeObservabilityGateway,
  type RuntimeObservabilityReport,
} from "../domain/runtimeObservability";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

const PHP_STATUS_EVENT = "language-server://status";
const JAVASCRIPT_TYPESCRIPT_STATUS_EVENT =
  "javascript-typescript-language-server://status";

const COMMANDS = {
  getObservability: "get_runtime_observability",
  restart: "restart_language_runtime",
  stop: "stop_language_runtime",
  openLog: "open_language_runtime_log",
};

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type ListenToEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<UnsubscribeFn>;
type RuntimeDetector = () => boolean;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);
const listenToEvent: ListenToEvent = (event, handler) =>
  listen(event, handler);

/// Drop a report that belongs to a different workspace root than the one the
/// caller requested. This is the per-project isolation guard: a status push or a
/// stale invoke result for another open tab must never feed the active panel.
function reportForRequestedRoot(
  report: RuntimeObservabilityReport,
  rootPath: string,
): RuntimeObservabilityReport {
  if (report.rootPath && workspaceRootKeysEqual(report.rootPath, rootPath)) {
    return report;
  }

  return emptyRuntimeObservabilityReport(rootPath);
}

export class TauriRuntimeObservabilityGateway
  implements RuntimeObservabilityGateway
{
  constructor(
    private readonly invoke: InvokeCommand = invokeCommand,
    private readonly listen: ListenToEvent = listenToEvent,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  getObservability(rootPath: string): Promise<RuntimeObservabilityReport> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(emptyRuntimeObservabilityReport(rootPath));
    }

    return this.invoke(COMMANDS.getObservability, { rootPath }).then((report) =>
      reportForRequestedRoot(report as RuntimeObservabilityReport, rootPath),
    );
  }

  restart(rootPath: string, kind: LanguageRuntimeKind): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invoke(COMMANDS.restart, { rootPath, kind }).then(
      () => undefined,
    );
  }

  stop(rootPath: string, kind: LanguageRuntimeKind): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invoke(COMMANDS.stop, { rootPath, kind }).then(() => undefined);
  }

  openLog(
    rootPath: string,
    kind: LanguageRuntimeKind,
  ): Promise<string | null> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(null);
    }

    return this.invoke(COMMANDS.openLog, { kind, rootPath }) as Promise<string>;
  }

  async subscribeStatus(listener: () => void): Promise<UnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return () => undefined;
    }

    const unsubscribers = await Promise.all([
      this.listen(PHP_STATUS_EVENT, () => listener()),
      this.listen(JAVASCRIPT_TYPESCRIPT_STATUS_EVENT, () => listener()),
    ]);

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }

  copyToClipboard(text: string): Promise<void> {
    if (!navigator.clipboard) {
      return Promise.reject(new Error("Clipboard is unavailable."));
    }

    return navigator.clipboard.writeText(text);
  }
}
