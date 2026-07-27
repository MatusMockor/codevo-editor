import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Breakpoint,
  DebugCompoundRuntimeStatus,
  DebugCompoundStartRequest,
  DebugEvent,
  DebugDisconnectRequest,
  DebugExceptionPauseMode,
  DebugFunctionBreakpointInput,
  DebugGateway,
  DebugLaunchTarget,
  DebugRuntimeStatus,
  DebugRestartFrameRequest,
  DebugSetBreakpointsActiveRequest,
  DebugSetFunctionBreakpointsRequest,
  DebugSetExpressionRequest,
  DebugSetExpressionResult,
  DebugSetVariableRequest,
  DebugRunToLocationRequest,
  DebugScope,
  DebugScopesRequest,
  DebugVariable,
  DebugVariablePage,
  DebugVariablePageRequest,
  FunctionBreakpointVerification,
  StackFrame,
  StepKind,
} from "../domain/debug";
import type {
  DebugEvaluationContext,
  DebugEvaluationResult,
} from "../domain/debugEvaluationPolicy";
import type {
  DebugConsoleCompletionRequest,
  DebugConsoleCompletionResponse,
} from "../domain/debugConsoleCompletions";
import type { DebugExceptionTypeFilter } from "../domain/debugExceptionTypeFilter";
import { decodeFunctionBreakpointVerificationList } from "../domain/debugFunctionBreakpoints";
import type {
  NativeNodeWatchDebugGateway,
  NativeNodeWatchDebugStartRequest,
} from "../domain/nativeNodeWatchDebugGateway";
import {
  DEBUG_IPC_COMMANDS,
  decodeDebugEvent,
  invokeDebugIpc,
  type DebugStartResponseWire,
  type DebugCompoundStartResponseWire,
  type DebugEvaluationResultWire,
  type InvokeDebugCommand,
} from "./tauriDebugIpcContract";

const DEBUG_EVENT = "debug://event";
const DESKTOP_RUNTIME_REQUIRED = "Debugging requires the Tauri desktop runtime.";
const DEBUG_RUN_TO_LOCATION_FAILED = "Unable to run debugging to the selected location.";
const DEBUG_RESTART_FRAME_FAILED = "Unable to restart the selected stack frame.";

type ListenToDebugEvents = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;
type RuntimeDetector = () => boolean;

const invokeDebugCommand: InvokeDebugCommand = (command, args) => invoke(command, args);
const listenToDebugEvents: ListenToDebugEvents = (event, handler) =>
  listen<unknown>(event, handler);

function toRuntimeStatus(response: DebugStartResponseWire): DebugRuntimeStatus {
  if (response.status === "ok") {
    return { kind: "ok", sessionId: response.sessionId };
  }

  if (response.status === "unavailable") {
    return { kind: "unavailable", message: response.message };
  }

  return { kind: "error", message: response.message };
}

function toCompoundRuntimeStatus(
  response: DebugCompoundStartResponseWire,
): DebugCompoundRuntimeStatus {
  if (response.status === "ok") {
    return { kind: "ok", sessionIds: Object.freeze([...response.sessionIds]) };
  }
  return { kind: response.status, message: response.message };
}

export class TauriDebugGateway implements DebugGateway, NativeNodeWatchDebugGateway {
  constructor(
    private readonly invokeCommand: InvokeDebugCommand = invokeDebugCommand,
    private readonly listenToEvent: ListenToDebugEvents = listenToDebugEvents,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async start(
    rootPath: string,
    launch: DebugLaunchTarget,
    breakpoints: readonly Breakpoint[],
    exceptionPauseMode: DebugExceptionPauseMode = "none",
    exceptionTypeFilter: DebugExceptionTypeFilter = [],
    functionBreakpoints: readonly DebugFunctionBreakpointInput[] = [],
  ): Promise<DebugRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return { kind: "unavailable", message: DESKTOP_RUNTIME_REQUIRED };
    }

    const response = await invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.start, {
      rootPath,
      launch,
      breakpoints: [...breakpoints],
      functionBreakpoints: functionBreakpoints.map(({ enabled, functionName, id }) => ({
        enabled,
        functionName,
        id,
      })),
      exceptionPauseMode,
      exceptionTypeFilter: [...exceptionTypeFilter],
    });

    return toRuntimeStatus(response);
  }

  async startCompound(request: DebugCompoundStartRequest): Promise<DebugCompoundRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return { kind: "unavailable", message: DESKTOP_RUNTIME_REQUIRED };
    }
    const ownedRequest: DebugCompoundStartRequest = {
      rootPath: request.rootPath,
      members: request.members.map((member) => ({
        launch: member.launch,
        breakpoints: [...member.breakpoints],
        exceptionPauseMode: member.exceptionPauseMode,
        exceptionTypeFilter: [...member.exceptionTypeFilter],
      })),
      stopAll: true,
    };
    const response = await invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.startCompound, {
      request: ownedRequest,
    });
    return toCompoundRuntimeStatus(response);
  }

  async startNativeNodeWatch(
    request: NativeNodeWatchDebugStartRequest,
  ): Promise<DebugRuntimeStatus> {
    if (!this.isRuntimeAvailable()) {
      return { kind: "unavailable", message: DESKTOP_RUNTIME_REQUIRED };
    }
    const response = await invokeDebugIpc(
      this.invokeCommand,
      DEBUG_IPC_COMMANDS.startNativeNodeWatch,
      {
        request: {
          ...request,
          breakpoints: [...request.breakpoints],
          functionBreakpoints: request.functionBreakpoints.map(({ enabled, functionName, id }) => ({
            enabled,
            functionName,
            id,
          })),
          exceptionTypeFilter: [...request.exceptionTypeFilter],
        },
      },
    );
    return toRuntimeStatus(response);
  }

  async confirmNativeNodeWatch(rootPath: string, sessionId: number): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      throw new Error(DESKTOP_RUNTIME_REQUIRED);
    }
    await invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.confirmNativeNodeWatch, {
      rootPath,
      sessionId,
    });
  }

  stop(sessionId: number): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.stop, { sessionId });
  }

  disconnect(request: DebugDisconnectRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.disconnect, { request });
  }

  setBreakpoints(
    rootPath: string,
    sessionId: number,
    filePath: string,
    breakpoints: readonly Breakpoint[],
  ): Promise<Breakpoint[]> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve([]);
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.setBreakpoints, {
      request: {
        rootPath,
        sessionId,
        filePath,
        breakpoints: [...breakpoints],
      },
    });
  }

  setBreakpointsActive(request: DebugSetBreakpointsActiveRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.setBreakpointsActive, {
      request,
    });
  }

  setFunctionBreakpoints(
    request: DebugSetFunctionBreakpointsRequest,
  ): Promise<readonly FunctionBreakpointVerification[]> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve([]);
    }
    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.setFunctionBreakpoints, {
      request,
    });
  }

  step(sessionId: number, kind: StepKind): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.step, {
      sessionId,
      kind,
    });
  }

  pause(sessionId: number): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.pause, { sessionId });
  }

  restartFrame(request: DebugRestartFrameRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.restartFrame, {
      request,
    }).catch(() => {
      throw new Error(DEBUG_RESTART_FRAME_FAILED);
    });
  }

  runToLocation(request: DebugRunToLocationRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.runToLocation, {
      request,
    }).catch(() => {
      throw new Error(DEBUG_RUN_TO_LOCATION_FAILED);
    });
  }

  setExceptionPause(
    rootPath: string,
    sessionId: number,
    mode: DebugExceptionPauseMode,
    exceptionTypeFilter: DebugExceptionTypeFilter = [],
  ): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.setExceptionPause, {
      request: {
        rootPath,
        sessionId,
        mode,
        exceptionTypeFilter: [...exceptionTypeFilter],
      },
    });
  }

  stackTrace(sessionId: number): Promise<StackFrame[]> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve([]);
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.stackTrace, {
      sessionId,
    });
  }

  scopesAtPause(request: DebugScopesRequest): Promise<DebugScope[]> {
    if (!this.isRuntimeAvailable()) return Promise.resolve([]);
    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.scopes, {
      request,
    });
  }

  variablesPage(request: DebugVariablePageRequest): Promise<DebugVariablePage> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve({
        variables: [],
        start: request.start,
        returned: 0,
        truncated: false,
      });
    }

    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.variables, { request });
  }

  setVariable(request: DebugSetVariableRequest): Promise<DebugVariable> {
    if (!this.isRuntimeAvailable()) {
      return Promise.reject(new Error(DESKTOP_RUNTIME_REQUIRED));
    }
    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.setVariable, { request });
  }

  setExpression(request: DebugSetExpressionRequest): Promise<DebugSetExpressionResult> {
    if (!this.isRuntimeAvailable()) {
      return Promise.reject(new Error(DESKTOP_RUNTIME_REQUIRED));
    }
    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.setExpression, { request });
  }

  completions(request: DebugConsoleCompletionRequest): Promise<DebugConsoleCompletionResponse> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(Object.freeze({ items: Object.freeze([]), isIncomplete: false }));
    }
    return invokeDebugIpc(this.invokeCommand, DEBUG_IPC_COMMANDS.completions, { request });
  }

  async evaluate(
    rootPath: string,
    sessionId: number,
    frameId: number,
    expression: string,
    context: DebugEvaluationContext,
    allowSideEffects: boolean,
    pauseGeneration: number,
  ): Promise<DebugEvaluationResult | null> {
    if (!this.isRuntimeAvailable()) {
      return null;
    }
    const result: DebugEvaluationResultWire = await invokeDebugIpc(
      this.invokeCommand,
      DEBUG_IPC_COMMANDS.evaluate,
      {
        request: {
          rootPath,
          sessionId,
          frameId,
          pauseGeneration,
          expression,
          context,
          allowSideEffects,
        },
      },
    );
    if (result.status === "error") return result;
    return {
      status: "ok",
      value: result.value.value,
      type: result.value.type,
      ...(result.value.evaluateName === undefined
        ? {}
        : { evaluateName: result.value.evaluateName }),
      variablesReference: result.value.variablesReference,
      ...(result.value.setExpressionReference === undefined
        ? {}
        : { setExpressionReference: result.value.setExpressionReference }),
    };
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

      handler(decodeGatewayDebugEvent(event.payload));
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

function decodeGatewayDebugEvent(value: unknown): DebugEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return decodeDebugEvent(value);
  }
  const record = value as Record<string, unknown>;
  if (
    !record.payload ||
    typeof record.payload !== "object" ||
    Array.isArray(record.payload) ||
    (record.payload as Record<string, unknown>).kind !== "functionBreakpointsVerified"
  ) {
    return decodeDebugEvent(value);
  }
  const payload = record.payload as Record<string, unknown>;
  if (
    Object.keys(payload).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(payload, "breakpoints") ||
    !Object.prototype.hasOwnProperty.call(payload, "generation")
  ) {
    throw new Error("Invalid debug function breakpoint verification event.");
  }
  const breakpoints = decodeFunctionBreakpointVerificationList(payload.breakpoints);
  const generation = payload.generation;
  if (!breakpoints || new Set(breakpoints.map(({ id }) => id)).size !== breakpoints.length) {
    throw new Error("Invalid debug function breakpoint verification event.");
  }
  if (!Number.isSafeInteger(generation) || (generation as number) <= 0) {
    throw new Error("Invalid debug function breakpoint verification event.");
  }
  const envelope = decodeDebugEvent({ ...record, payload: { kind: "resumed" } });
  return {
    ...envelope,
    payload: {
      kind: "functionBreakpointsVerified",
      generation: generation as number,
      breakpoints,
    },
  };
}
