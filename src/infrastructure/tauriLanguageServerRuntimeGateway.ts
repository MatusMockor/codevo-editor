import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStartOptions,
  LanguageServerRuntimeStatus,
  UnsubscribeFn,
} from "../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

const STATUS_EVENT = "language-server://status";
const DESKTOP_RUNTIME_REQUIRED =
  "Language server requires the Tauri desktop runtime.";
const DEFAULT_RUNTIME_COMMANDS = {
  getStatus: "get_php_language_server_status",
  start: "start_php_language_server",
  stop: "stop_php_language_server",
  statusEvent: STATUS_EVENT,
};

export const JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS = {
  getStatus: "get_javascript_typescript_language_server_status",
  openLog: "open_javascript_typescript_language_server_log",
  start: "start_javascript_typescript_language_server",
  statusEvent: "javascript-typescript-language-server://status",
  stop: "stop_javascript_typescript_language_server",
};

export interface TauriLanguageServerRuntimeCommands {
  getStatus: string;
  openLog?: string;
  start: string;
  statusEvent: string;
  stop: string;
}

type InvokeRuntimeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type ListenToRuntimeStatus = (
  event: string,
  handler: (event: { payload: LanguageServerRuntimeStatus }) => void,
) => Promise<UnsubscribeFn>;
type RuntimeDetector = () => boolean;

const invokeRuntimeCommand: InvokeRuntimeCommand = (command, args) =>
  invoke(command, args);
const listenToRuntimeStatus: ListenToRuntimeStatus = (event, handler) =>
  listen<LanguageServerRuntimeStatus>(event, handler);

function stoppedStatus(rootPath: string): LanguageServerRuntimeStatus {
  return { kind: "stopped", rootPath };
}

function statusForRequestedRoot(
  status: LanguageServerRuntimeStatus,
  rootPath: string,
): LanguageServerRuntimeStatus {
  if (status.rootPath && workspaceRootKeysEqual(status.rootPath, rootPath)) {
    return status;
  }

  return stoppedStatus(rootPath);
}

export class TauriLanguageServerRuntimeGateway
  implements LanguageServerRuntimeGateway
{
  constructor(
    private readonly invokeCommand: InvokeRuntimeCommand = invokeRuntimeCommand,
    private readonly listenToEvent: ListenToRuntimeStatus = listenToRuntimeStatus,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly commands: TauriLanguageServerRuntimeCommands =
      DEFAULT_RUNTIME_COMMANDS,
  ) {}

  getStatus(rootPath: string): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(stoppedStatus(rootPath));
    }

    return this.invokeCommand(this.commands.getStatus, { rootPath }).then(
      (status) =>
        statusForRequestedRoot(status as LanguageServerRuntimeStatus, rootPath),
    );
  }

  start(
    rootPath: string,
    options: LanguageServerRuntimeStartOptions = {},
  ): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve({
        kind: "crashed",
        message: DESKTOP_RUNTIME_REQUIRED,
        rootPath,
      });
    }

    const args: Record<string, unknown> = { rootPath };

    if (options.autoImportsEnabled !== undefined) {
      args.autoImportsEnabled = options.autoImportsEnabled;
    }

    if (options.automaticTypeAcquisitionEnabled !== undefined) {
      args.automaticTypeAcquisitionEnabled =
        options.automaticTypeAcquisitionEnabled;
    }

    if (options.codeLensEnabled !== undefined) {
      args.codeLensEnabled = options.codeLensEnabled;
    }

    if (options.completeFunctionCalls !== undefined) {
      args.completeFunctionCalls = options.completeFunctionCalls;
    }

    if (options.importModuleSpecifierEnding) {
      args.importModuleSpecifierEnding = options.importModuleSpecifierEnding;
    }

    if (options.importModuleSpecifierPreference) {
      args.importModuleSpecifierPreference =
        options.importModuleSpecifierPreference;
    }

    if (options.typeScriptVersionPreference) {
      args.typeScriptVersionPreference = options.typeScriptVersionPreference;
    }

    if (options.inlayHintsEnabled !== undefined) {
      args.inlayHintsEnabled = options.inlayHintsEnabled;
    }

    if (options.preferTypeOnlyAutoImports !== undefined) {
      args.preferTypeOnlyAutoImports = options.preferTypeOnlyAutoImports;
    }

    if (options.quotePreference) {
      args.quotePreference = options.quotePreference;
    }

    if (options.phpBackend) {
      args.phpBackend = options.phpBackend;
    }

    if (options.phpactorPath) {
      args.phpactorPath = options.phpactorPath;
    }

    if (options.intelephensePath) {
      args.intelephensePath = options.intelephensePath;
    }

    if (options.validationEnabled !== undefined) {
      args.validationEnabled = options.validationEnabled;
    }

    return this.invokeCommand(this.commands.start, args).then((status) =>
      statusForRequestedRoot(status as LanguageServerRuntimeStatus, rootPath),
    );
  }

  stop(rootPath: string): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(stoppedStatus(rootPath));
    }

    return this.invokeCommand(this.commands.stop, { rootPath }).then((status) =>
      statusForRequestedRoot(status as LanguageServerRuntimeStatus, rootPath),
    );
  }

  openLog(rootPath: string): Promise<string | null> {
    if (!this.isRuntimeAvailable() || !this.commands.openLog) {
      return Promise.resolve(null);
    }

    return this.invokeCommand(this.commands.openLog, { rootPath }) as Promise<string>;
  }

  subscribeStatus(
    listener: (status: LanguageServerRuntimeStatus) => void,
  ): Promise<UnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(this.commands.statusEvent, (event) => {
      listener(event.payload);
    });
  }
}
