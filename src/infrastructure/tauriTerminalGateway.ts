import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  TerminalGateway,
  TerminalOutputEvent,
  TerminalProfile,
  TerminalRuntimeStatus,
  TerminalSize,
  TerminalUnsubscribeFn,
} from "../domain/terminal";

const OUTPUT_EVENT = "terminal://output";
const DESKTOP_RUNTIME_REQUIRED =
  "Terminal requires the Tauri desktop runtime.";

type InvokeTerminalCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type ListenToTerminalOutput = (
  event: string,
  handler: (event: { payload: TerminalOutputEvent }) => void,
) => Promise<TerminalUnsubscribeFn>;
type RuntimeDetector = () => boolean;

const invokeTerminalCommand: InvokeTerminalCommand = (command, args) =>
  invoke(command, args);
const listenToTerminalOutput: ListenToTerminalOutput = (event, handler) =>
  listen<TerminalOutputEvent>(event, handler);

export class TauriTerminalGateway implements TerminalGateway {
  constructor(
    private readonly invokeCommand: InvokeTerminalCommand = invokeTerminalCommand,
    private readonly listenToEvent: ListenToTerminalOutput = listenToTerminalOutput,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  listProfiles(): Promise<TerminalProfile[]> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve([]);
    }

    return this.invokeCommand("list_terminal_profiles") as Promise<
      TerminalProfile[]
    >;
  }

  start(
    rootPath: string,
    size: TerminalSize,
    profileId?: string,
  ): Promise<TerminalRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.reject(new Error(DESKTOP_RUNTIME_REQUIRED));
    }

    return this.invokeCommand("start_terminal_session", {
      profileId,
      rootPath,
      size,
    }) as Promise<TerminalRuntimeStatus>;
  }

  writeInput(sessionId: number, data: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeCommand("write_terminal_input", {
      data,
      sessionId,
    }) as Promise<void>;
  }

  resize(sessionId: number, size: TerminalSize): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeCommand("resize_terminal_session", {
      sessionId,
      size,
    }) as Promise<void>;
  }

  stop(sessionId: number): Promise<TerminalRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve({ kind: "stopped", sessionId });
    }

    return this.invokeCommand("stop_terminal_session", {
      sessionId,
    }) as Promise<TerminalRuntimeStatus>;
  }

  subscribeOutput(
    listener: (event: TerminalOutputEvent) => void,
  ): Promise<TerminalUnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(OUTPUT_EVENT, (event) => {
      listener(event.payload);
    });
  }
}
