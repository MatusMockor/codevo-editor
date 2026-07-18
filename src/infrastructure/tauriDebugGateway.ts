import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Breakpoint,
  DebugEvent,
  DebugGateway,
  DebugLaunchTarget,
  DebugRuntimeStatus,
  DebugScope,
  DebugVariable,
  StackFrame,
  StepKind,
} from "../domain/debug";

const DEBUG_EVENT = "debug://event";
const DESKTOP_RUNTIME_REQUIRED =
  "Debugging requires the Tauri desktop runtime.";

type InvokeDebugCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type ListenToDebugEvents = (
  event: string,
  handler: (event: { payload: DebugEvent }) => void,
) => Promise<() => void>;
type RuntimeDetector = () => boolean;

type WireStartResponse =
  | { status: "ok"; sessionId: number }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

const invokeDebugCommand: InvokeDebugCommand = (command, args) =>
  invoke(command, args);
const listenToDebugEvents: ListenToDebugEvents = (event, handler) =>
  listen<DebugEvent>(event, handler);

function toRuntimeStatus(response: WireStartResponse): DebugRuntimeStatus {
  if (response.status === "ok") {
    return { kind: "ok", sessionId: response.sessionId };
  }

  if (response.status === "unavailable") {
    return { kind: "unavailable", message: response.message };
  }

  return { kind: "error", message: response.message };
}

export class TauriDebugGateway implements DebugGateway {
  constructor(
    private readonly invokeCommand: InvokeDebugCommand = invokeDebugCommand,
    private readonly listenToEvent: ListenToDebugEvents = listenToDebugEvents,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async start(
    rootPath: string,
    launch: DebugLaunchTarget,
    breakpoints: readonly Breakpoint[],
  ): Promise<DebugRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return { kind: "unavailable", message: DESKTOP_RUNTIME_REQUIRED };
    }

    const response = (await this.invokeCommand("debug_start", {
      rootPath,
      launch,
      breakpoints: [...breakpoints],
    })) as WireStartResponse;

    return toRuntimeStatus(response);
  }

  stop(sessionId: number): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeCommand("debug_stop", { sessionId }) as Promise<void>;
  }

  setBreakpoints(
    sessionId: number,
    filePath: string,
    breakpoints: readonly Breakpoint[],
  ): Promise<Breakpoint[]> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve([]);
    }

    return this.invokeCommand("debug_set_breakpoints", {
      sessionId,
      filePath,
      breakpoints: [...breakpoints],
    }) as Promise<Breakpoint[]>;
  }

  step(sessionId: number, kind: StepKind): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeCommand("debug_step", {
      sessionId,
      kind,
    }) as Promise<void>;
  }

  pause(sessionId: number): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeCommand("debug_pause", { sessionId }) as Promise<void>;
  }

  stackTrace(sessionId: number): Promise<StackFrame[]> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve([]);
    }

    return this.invokeCommand("debug_stack_trace", {
      sessionId,
    }) as Promise<StackFrame[]>;
  }

  scopes(sessionId: number, frameId: number): Promise<DebugScope[]> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve([]);
    }

    return this.invokeCommand("debug_scopes", {
      sessionId,
      frameId,
    }) as Promise<DebugScope[]>;
  }

  variables(
    sessionId: number,
    variablesReference: number,
  ): Promise<DebugVariable[]> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve([]);
    }

    return this.invokeCommand("debug_variables", {
      sessionId,
      variablesReference,
    }) as Promise<DebugVariable[]>;
  }

  evaluate(
    rootPath: string,
    sessionId: number,
    frameId: number,
    expression: string,
  ): Promise<DebugVariable | null> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(null);
    }

    return this.invokeCommand("debug_evaluate", {
      rootPath,
      sessionId,
      frameId,
      expression,
    }) as Promise<DebugVariable | null>;
  }

  subscribe(handler: (event: DebugEvent) => void): () => void {
    if (!this.isRuntimeAvailable()) {
      return () => undefined;
    }

    let disposed = false;
    const unlistenPromise = this.listenToEvent(DEBUG_EVENT, (event) => {
      if (disposed) {
        return;
      }

      handler(event.payload);
    });
    unlistenPromise.catch(() => undefined);

    return () => {
      if (disposed) {
        return;
      }

      disposed = true;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }
}
