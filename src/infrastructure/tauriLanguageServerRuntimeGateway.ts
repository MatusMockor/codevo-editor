import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStartOptions,
  LanguageServerRuntimeStatus,
  UnsubscribeFn,
} from "../domain/languageServerRuntime";

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
  start: "start_javascript_typescript_language_server",
  statusEvent: "javascript-typescript-language-server://status",
  stop: "stop_javascript_typescript_language_server",
};

export interface TauriLanguageServerRuntimeCommands {
  getStatus: string;
  start: string;
  statusEvent: string;
  stop: string;
}

type InvokeRuntimeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<LanguageServerRuntimeStatus>;
type ListenToRuntimeStatus = (
  event: string,
  handler: (event: { payload: LanguageServerRuntimeStatus }) => void,
) => Promise<UnsubscribeFn>;
type RuntimeDetector = () => boolean;

const invokeRuntimeCommand: InvokeRuntimeCommand = (command, args) =>
  invoke<LanguageServerRuntimeStatus>(command, args);
const listenToRuntimeStatus: ListenToRuntimeStatus = (event, handler) =>
  listen<LanguageServerRuntimeStatus>(event, handler);

function stoppedStatus(): LanguageServerRuntimeStatus {
  return { kind: "stopped" };
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
      return Promise.resolve(stoppedStatus());
    }

    return this.invokeCommand(this.commands.getStatus, { rootPath });
  }

  start(
    rootPath: string,
    options: LanguageServerRuntimeStartOptions = {},
  ): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve({
        kind: "crashed",
        message: DESKTOP_RUNTIME_REQUIRED,
      });
    }

    const args: Record<string, unknown> = { rootPath };

    if (options.autoImportsEnabled !== undefined) {
      args.autoImportsEnabled = options.autoImportsEnabled;
    }

    if (options.typeScriptVersionPreference) {
      args.typeScriptVersionPreference = options.typeScriptVersionPreference;
    }

    if (options.inlayHintsEnabled !== undefined) {
      args.inlayHintsEnabled = options.inlayHintsEnabled;
    }

    return this.invokeCommand(this.commands.start, args);
  }

  stop(rootPath: string): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(stoppedStatus());
    }

    return this.invokeCommand(this.commands.stop, { rootPath });
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
