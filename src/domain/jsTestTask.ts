import type { JsTestRunScope } from "./jsTestRunScope";
import type { TestRunResponse } from "./testResults";

export const MAX_JS_TEST_TASK_ID_BYTES = 64;
export const MAX_JS_TEST_OUTPUT_STREAM_BYTES = 65_536;

export interface JsTestTaskOwner {
  readonly runId: string;
  readonly workspaceId: string;
}

export interface JsTestTaskRunRequest extends JsTestTaskOwner {
  readonly scope: JsTestRunScope;
}

export interface JsTestTaskOutputStream {
  readonly text: string;
  readonly truncated: boolean;
}

export interface JsTestTaskOutput {
  readonly stdout: JsTestTaskOutputStream;
  readonly stderr: JsTestTaskOutputStream;
}

export type JsTestTaskRunResponse = {
  readonly owner: JsTestTaskOwner;
  readonly output: JsTestTaskOutput;
  readonly response: TestRunResponse | { readonly status: "cancelled" };
};

export type JsTestTaskStopRequest = JsTestTaskOwner;

export interface JsTestTaskGateway {
  runTask(request: JsTestTaskRunRequest): Promise<JsTestTaskRunResponse>;
  stopTask(request: JsTestTaskStopRequest): Promise<boolean>;
}

export function validatedJsTestTaskRunId(runId: string): string {
  return validatedOpaqueTaskId(runId, "runId");
}

export function validatedJsTestTaskWorkspaceId(workspaceId: string): string {
  return validatedOpaqueTaskId(workspaceId, "workspaceId");
}

function validatedOpaqueTaskId(value: string, name: "runId" | "workspaceId"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0 ||
    !isWellFormedUnicode(value) ||
    /\p{Cc}/u.test(value) ||
    new TextEncoder().encode(value).byteLength > MAX_JS_TEST_TASK_ID_BYTES
  ) {
    throw new Error(
      `JavaScript test task ${name} must be a non-empty, control-free opaque ID of at most ${MAX_JS_TEST_TASK_ID_BYTES} UTF-8 bytes.`,
    );
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
