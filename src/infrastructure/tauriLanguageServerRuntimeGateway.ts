import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStatus,
  UnsubscribeFn,
} from "../domain/languageServerRuntime";

const STATUS_EVENT = "language-server://status";
const DESKTOP_RUNTIME_REQUIRED =
  "Language server requires the Tauri desktop runtime.";

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
  ) {}

  getStatus(): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(stoppedStatus());
    }

    return this.invokeCommand("get_php_language_server_status");
  }

  start(rootPath: string): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve({
        kind: "crashed",
        message: DESKTOP_RUNTIME_REQUIRED,
      });
    }

    return this.invokeCommand("start_php_language_server", {
      rootPath,
    });
  }

  stop(): Promise<LanguageServerRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(stoppedStatus());
    }

    return this.invokeCommand("stop_php_language_server");
  }

  subscribeStatus(
    listener: (status: LanguageServerRuntimeStatus) => void,
  ): Promise<UnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(STATUS_EVENT, (event) => {
      listener(event.payload);
    });
  }
}
