import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStartOptions,
  LanguageServerRuntimeStatus,
  UnsubscribeFn,
} from "../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  decodeLanguageServerRuntimeLogPath,
  decodeLanguageServerRuntimeStatus,
  invokeLanguageServerRuntimeIpc,
  type InvokeLanguageServerRuntimeCommand,
  type LanguageServerRuntimeCommandProfile,
  type LanguageServerRuntimeIpcArgs,
} from "./tauriLanguageServerRuntimeIpcContract";

const STATUS_EVENT = "language-server://status";
const DESKTOP_RUNTIME_REQUIRED = "Language server requires the Tauri desktop runtime.";
const DEFAULT_RUNTIME_COMMANDS = {
  getStatus: "get_php_language_server_status",
  start: "start_php_language_server",
  stop: "stop_php_language_server",
  statusEvent: STATUS_EVENT,
} as const;

export const JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS = {
  cancelRequest: "cancel_lsp_request",
  getStatus: "get_javascript_typescript_language_server_status",
  openLog: "open_language_runtime_log",
  openLogKind: "tsserver",
  start: "start_javascript_typescript_language_server",
  statusEvent: "javascript-typescript-language-server://status",
  stop: "stop_javascript_typescript_language_server",
} as const;

export function cancelJavaScriptTypeScriptLanguageServerRequest(
  rootPath: string,
  requestId: number,
): Promise<void> {
  if (!isTauri()) {
    return Promise.resolve();
  }

  return invokeLanguageServerRuntimeIpc(
    invokeRuntimeCommand,
    JAVASCRIPT_TYPESCRIPT_RUNTIME_COMMANDS,
    "cancelRequest",
    { requestId, rootPath },
  );
}

export interface TauriLanguageServerRuntimeCommands extends LanguageServerRuntimeCommandProfile {
  openLogKind?: "phpactor" | "tsserver";
  statusEvent: string;
}

type ListenToRuntimeStatus = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<UnsubscribeFn>;
type RuntimeDetector = () => boolean;

const invokeRuntimeCommand: InvokeLanguageServerRuntimeCommand = (command, args) =>
  invoke(command, args);
const listenToRuntimeStatus: ListenToRuntimeStatus = (event, handler) =>
  listen<unknown>(event, handler);

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

export class TauriLanguageServerRuntimeGateway implements LanguageServerRuntimeGateway {
  constructor(
    private readonly invokeCommand: InvokeLanguageServerRuntimeCommand = invokeRuntimeCommand,
    private readonly listenToEvent: ListenToRuntimeStatus = listenToRuntimeStatus,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly commands: TauriLanguageServerRuntimeCommands = DEFAULT_RUNTIME_COMMANDS,
  ) {}

  getStatus(rootPath: string): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(stoppedStatus(rootPath));
    }

    return invokeLanguageServerRuntimeIpc(this.invokeCommand, this.commands, "getStatus", {
      rootPath,
    }).then((status) =>
      statusForRequestedRoot(decodeLanguageServerRuntimeStatus(status), rootPath),
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

    const args: LanguageServerRuntimeIpcArgs<"start"> = { rootPath };

    if (options.autoImportsEnabled !== undefined) {
      args.autoImportsEnabled = options.autoImportsEnabled;
    }

    if (options.automaticTypeAcquisitionEnabled !== undefined) {
      args.automaticTypeAcquisitionEnabled = options.automaticTypeAcquisitionEnabled;
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
      args.importModuleSpecifierPreference = options.importModuleSpecifierPreference;
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

    return invokeLanguageServerRuntimeIpc(this.invokeCommand, this.commands, "start", args).then(
      (status) => statusForRequestedRoot(decodeLanguageServerRuntimeStatus(status), rootPath),
    );
  }

  stop(rootPath: string): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(stoppedStatus(rootPath));
    }

    return invokeLanguageServerRuntimeIpc(this.invokeCommand, this.commands, "stop", {
      rootPath,
    }).then((status) =>
      statusForRequestedRoot(decodeLanguageServerRuntimeStatus(status), rootPath),
    );
  }

  openLog(rootPath: string): Promise<string | null> {
    if (!this.isRuntimeAvailable() || !this.commands.openLog || !this.commands.openLogKind) {
      return Promise.resolve(null);
    }

    return invokeLanguageServerRuntimeIpc(this.invokeCommand, this.commands, "openLog", {
      kind: this.commands.openLogKind,
      rootPath,
    }).then(decodeLanguageServerRuntimeLogPath);
  }

  subscribeStatus(listener: (status: LanguageServerRuntimeStatus) => void): Promise<UnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(this.commands.statusEvent, (event) => {
      listener(decodeLanguageServerRuntimeStatus(event.payload));
    });
  }
}
