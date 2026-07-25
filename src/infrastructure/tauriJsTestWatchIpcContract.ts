import {
  parseJsTestWatchOutputEvent,
  parseJsTestWatchStatusEvent,
  parseStartJsTestWatchResult,
  validateJsTestWatchOwner,
  validateStartJsTestWatchRequest,
  type JsTestWatchOutputEvent,
  type JsTestWatchOwner,
  type JsTestWatchStatusEvent,
  type StartJsTestWatchRequest,
  type StartJsTestWatchResult,
} from "../domain/jsTestCommand";

export const START_JS_TEST_WATCH_IPC_COMMAND = "workspace_start_js_test_watch" as const;
export const ACKNOWLEDGE_JS_TEST_WATCH_START_IPC_COMMAND =
  "workspace_acknowledge_js_test_watch_start" as const;
export const STOP_JS_TEST_WATCH_IPC_COMMAND = "workspace_stop_js_test_watch" as const;
export const JS_TEST_WATCH_STATUS_EVENT = "js-test-watch://status" as const;
export const JS_TEST_WATCH_OUTPUT_EVENT = "js-test-watch://output" as const;

export type InvokeJsTestWatchCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function invokeStartJsTestWatchIpc(
  invokeCommand: InvokeJsTestWatchCommand,
  request: StartJsTestWatchRequest,
): Promise<StartJsTestWatchResult> {
  const validated = validateStartJsTestWatchRequest(request);
  const result = parseStartJsTestWatchResult(
    await invokeCommand(START_JS_TEST_WATCH_IPC_COMMAND, {
      request: validated,
    }),
  );
  if (!sameOwner(result.owner, validated)) {
    throw new TypeError(
      "Invalid JavaScript test watch value at result.owner: expected the requested owner.",
    );
  }
  return result;
}

export async function invokeAcknowledgeJsTestWatchStartIpc(
  invokeCommand: InvokeJsTestWatchCommand,
  owner: JsTestWatchOwner,
): Promise<void> {
  return invokeOwnerUnit(invokeCommand, ACKNOWLEDGE_JS_TEST_WATCH_START_IPC_COMMAND, owner);
}

export async function invokeStopJsTestWatchIpc(
  invokeCommand: InvokeJsTestWatchCommand,
  owner: JsTestWatchOwner,
): Promise<void> {
  return invokeOwnerUnit(invokeCommand, STOP_JS_TEST_WATCH_IPC_COMMAND, owner);
}

export function decodeJsTestWatchStatusEvent(value: unknown): JsTestWatchStatusEvent {
  return parseJsTestWatchStatusEvent(value);
}

export function decodeJsTestWatchOutputEvent(value: unknown): JsTestWatchOutputEvent {
  return parseJsTestWatchOutputEvent(value);
}

async function invokeOwnerUnit(
  invokeCommand: InvokeJsTestWatchCommand,
  command: string,
  owner: JsTestWatchOwner,
): Promise<void> {
  const validated = validateJsTestWatchOwner(owner);
  const value = await invokeCommand(command, { request: validated });
  if (value !== null) {
    throw new TypeError("Invalid JavaScript test watch value at result: expected null.");
  }
}

function sameOwner(left: JsTestWatchOwner, right: JsTestWatchOwner): boolean {
  return (
    left.watchId === right.watchId &&
    left.workspaceId === right.workspaceId &&
    left.epoch === right.epoch
  );
}
