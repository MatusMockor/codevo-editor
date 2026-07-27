import { invoke } from "@tauri-apps/api/core";
import {
  validatedJsTestRunScope,
  type JsTestGateway,
  type JsTestRunScope,
} from "../domain/jsTestRunScope";
import {
  MAX_JS_TEST_OUTPUT_STREAM_BYTES,
  validatedJsTestTaskRunId,
  validatedJsTestTaskWorkspaceId,
  type JsTestTaskGateway,
  type JsTestTaskOutput,
  type JsTestTaskOwner,
  type JsTestTaskRunRequest,
  type JsTestTaskRunResponse,
  type JsTestTaskStopRequest,
} from "../domain/jsTestTask";
import type { TestCase, TestGateway, TestRunResponse } from "../domain/testResults";
import {
  validatedJsTestExecutionAuthority,
  type JsTestExecutionAuthority,
} from "../domain/jsTestExecutionAuthority";

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export const JS_TEST_RESPONSE_LIMITS = Object.freeze({
  maxSuites: 5_000,
  maxCases: 5_000,
  maxPathBytes: 16 * 1024,
  maxNameBytes: 16 * 1024,
  maxMessageBytes: 64 * 1024,
  maxTextBytes: 16 * 1024 * 1024,
});

interface DecodeContext {
  cases: number;
  textBytes: number;
}

export class TauriJsTestGateway implements TestGateway, JsTestGateway, JsTestTaskGateway {
  constructor(private readonly invokeTestCommand = invokeCommand) {}

  run(
    rootPath: string,
    scope: JsTestRunScope,
    authority: JsTestExecutionAuthority,
  ): Promise<TestRunResponse>;
  run(rootPath: string, scope: JsTestRunScope): Promise<TestRunResponse>;
  run(rootPath: string, filter?: string): Promise<TestRunResponse>;
  async run(
    rootPath: string,
    request?: string | JsTestRunScope,
    authority?: JsTestExecutionAuthority,
  ): Promise<TestRunResponse> {
    const response =
      typeof request === "object"
        ? await this.invokeTestCommand("run_js_tests_scoped_json", {
            packageRootRelativePath: validatedJsTestExecutionAuthority(
              authority ?? { packageRootRelativePath: "" },
            ).packageRootRelativePath,
            rootPath,
            scope: validatedJsTestRunScope(request),
          })
        : await this.invokeTestCommand("run_js_tests_json", {
            filter: request,
            rootPath,
          });
    return decodeTestRunResponse(response);
  }

  async runTask(request: JsTestTaskRunRequest): Promise<JsTestTaskRunResponse> {
    const validatedRequest = {
      runId: validatedJsTestTaskRunId(request.runId),
      workspaceId: validatedJsTestTaskWorkspaceId(request.workspaceId),
      packageRootRelativePath: validatedJsTestExecutionAuthority({
        packageRootRelativePath: request.packageRootRelativePath ?? "",
      }).packageRootRelativePath,
      scope: validatedJsTestRunScope(request.scope),
    };
    const response = await this.invokeTestCommand("run_js_test_task_json", {
      request: validatedRequest,
    });
    return decodeJsTestTaskRunResponse(response, validatedRequest);
  }

  async stopTask(request: JsTestTaskStopRequest): Promise<boolean> {
    const validatedRequest = {
      runId: validatedJsTestTaskRunId(request.runId),
      workspaceId: validatedJsTestTaskWorkspaceId(request.workspaceId),
    };
    const response = record(
      await this.invokeTestCommand("stop_js_test_task", { request: validatedRequest }),
      "JavaScript test task stop response",
    );
    exactKeys(response, ["runId", "stopped"]);
    assertEchoedTaskRunId(response.runId, validatedRequest.runId);
    if (typeof response.stopped !== "boolean") throw invalid("stopped");
    return response.stopped;
  }
}

function decodeJsTestTaskRunResponse(
  value: unknown,
  expectedOwner: JsTestTaskOwner,
): JsTestTaskRunResponse {
  const envelope = record(value, "JavaScript test task run response");
  exactKeys(envelope, ["owner", "response", "output"]);
  const owner = decodeJsTestTaskOwner(envelope.owner, expectedOwner);
  const output = decodeJsTestTaskOutput(envelope.output);

  const response = record(envelope.response, "response");
  if (response.status === "cancelled") {
    exactKeys(response, ["status"]);
    return Object.freeze({
      owner,
      output,
      response: Object.freeze({ status: "cancelled" as const }),
    });
  }
  return Object.freeze({ owner, output, response: decodeTestRunResponse(response) });
}

function decodeJsTestTaskOwner(value: unknown, expected: JsTestTaskOwner): JsTestTaskOwner {
  const owner = record(value, "owner");
  exactKeys(owner, ["runId", "workspaceId"]);
  const runId = decodedTaskRunId(owner.runId, "owner.runId");
  const workspaceId = decodedTaskWorkspaceId(owner.workspaceId, "owner.workspaceId");
  if (runId !== expected.runId) throw invalid("owner.runId");
  if (workspaceId !== expected.workspaceId) throw invalid("owner.workspaceId");
  return Object.freeze({ runId, workspaceId });
}

function decodeJsTestTaskOutput(value: unknown): JsTestTaskOutput {
  const output = record(value, "output");
  exactKeys(output, ["stdout", "stderr"]);
  return Object.freeze({
    stdout: decodeJsTestTaskOutputStream(output.stdout, "output.stdout"),
    stderr: decodeJsTestTaskOutputStream(output.stderr, "output.stderr"),
  });
}

function decodeJsTestTaskOutputStream(
  value: unknown,
  path: "output.stdout" | "output.stderr",
): JsTestTaskOutput["stdout"] {
  const stream = record(value, path);
  exactKeys(stream, ["text", "truncated"]);
  if (
    typeof stream.text !== "string" ||
    !isWellFormedUnicode(stream.text) ||
    new TextEncoder().encode(stream.text).byteLength > MAX_JS_TEST_OUTPUT_STREAM_BYTES
  ) {
    throw invalid(`${path}.text`);
  }
  if (typeof stream.truncated !== "boolean") throw invalid(`${path}.truncated`);
  return Object.freeze({ text: stream.text, truncated: stream.truncated });
}

function decodedTaskRunId(value: unknown, path: string): string {
  try {
    return validatedJsTestTaskRunId(value as string);
  } catch {
    throw invalid(path);
  }
}

function decodedTaskWorkspaceId(value: unknown, path: string): string {
  try {
    return validatedJsTestTaskWorkspaceId(value as string);
  } catch {
    throw invalid(path);
  }
}

function assertEchoedTaskRunId(value: unknown, expectedRunId: string): void {
  let echoedRunId: string;
  try {
    echoedRunId = validatedJsTestTaskRunId(value as string);
  } catch {
    throw invalid("runId");
  }
  if (echoedRunId !== expectedRunId) throw invalid("runId");
}

function decodeTestRunResponse(value: unknown): TestRunResponse {
  const context: DecodeContext = { cases: 0, textBytes: 0 };
  const response = record(value, "JavaScript test response");
  exactKeys(
    response,
    response.status === "ok" ? ["status", "suites", "totals"] : ["status", "message"],
  );
  if (response.status === "unavailable" || response.status === "error") {
    return {
      status: response.status,
      message: string(
        response.message,
        "message",
        context,
        JS_TEST_RESPONSE_LIMITS.maxMessageBytes,
      ),
    };
  }
  if (response.status !== "ok") throw invalid("status");
  if (!Array.isArray(response.suites) || response.suites.length > JS_TEST_RESPONSE_LIMITS.maxSuites)
    throw invalid("suites");
  const suites = response.suites.map((suite, index) => decodeSuite(suite, index, context));
  const totals = decodeTotals(response.totals);
  assertAggregateCounts(suites, totals);
  return {
    status: "ok",
    suites,
    totals,
  };
}

function decodeSuite(value: unknown, index: number, context: DecodeContext) {
  const path = `suites[${index}]`;
  const suite = record(value, path);
  exactKeys(suite, ["name", "tests", "failures", "errors", "skipped", "time", "cases"]);
  if (!Array.isArray(suite.cases)) throw invalid(`${path}.cases`);
  context.cases = safeSum(context.cases, suite.cases.length, `${path}.cases`);
  if (context.cases > JS_TEST_RESPONSE_LIMITS.maxCases) throw invalid(`${path}.cases`);
  const cases = suite.cases.map((testCase, caseIndex) =>
    decodeCase(testCase, `${path}.cases[${caseIndex}]`, context),
  );
  const tests = count(suite.tests, `${path}.tests`);
  const failures = count(suite.failures, `${path}.failures`);
  const errors = count(suite.errors, `${path}.errors`);
  const skipped = count(suite.skipped, `${path}.skipped`);
  assertSuiteCounts(cases, { errors, failures, skipped, tests }, path);
  return {
    name: nullableString(suite.name, `${path}.name`, context, JS_TEST_RESPONSE_LIMITS.maxNameBytes),
    tests,
    failures,
    errors,
    skipped,
    time: nullableTime(suite.time, `${path}.time`),
    cases,
  };
}

function decodeCase(value: unknown, path: string, context: DecodeContext): TestCase {
  const testCase = record(value, path);
  exactKeys(testCase, ["name", "classname", "file", "line", "time", "status", "message"]);
  const status = testCase.status;
  if (status !== "passed" && status !== "failed" && status !== "error" && status !== "skipped") {
    throw invalid(`${path}.status`);
  }
  return {
    name: nullableString(
      testCase.name,
      `${path}.name`,
      context,
      JS_TEST_RESPONSE_LIMITS.maxNameBytes,
    ),
    classname: nullableString(
      testCase.classname,
      `${path}.classname`,
      context,
      JS_TEST_RESPONSE_LIMITS.maxNameBytes,
    ),
    file: nullableString(
      testCase.file,
      `${path}.file`,
      context,
      JS_TEST_RESPONSE_LIMITS.maxPathBytes,
    ),
    line: nullablePositiveInteger(testCase.line, `${path}.line`),
    time: nullableTime(testCase.time, `${path}.time`),
    status,
    message: nullableString(
      testCase.message,
      `${path}.message`,
      context,
      JS_TEST_RESPONSE_LIMITS.maxMessageBytes,
    ),
  };
}

function decodeTotals(value: unknown) {
  const totals = record(value, "totals");
  exactKeys(totals, ["tests", "failures", "errors", "skipped", "time"]);
  return {
    tests: count(totals.tests, "totals.tests"),
    failures: count(totals.failures, "totals.failures"),
    errors: count(totals.errors, "totals.errors"),
    skipped: count(totals.skipped, "totals.skipped"),
    time: nullableTime(totals.time, "totals.time"),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(path);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = Reflect.ownKeys(value);
  const unexpected = keys.find((key) => typeof key !== "string" || !allowed.includes(key));
  if (unexpected !== undefined) throw invalid(String(unexpected));
  const missing = allowed.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) throw invalid(missing);
}

function string(value: unknown, path: string, context: DecodeContext, maxBytes: number): string {
  if (typeof value !== "string" || !isWellFormedUnicode(value)) throw invalid(path);
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > maxBytes) throw invalid(path);
  context.textBytes = safeSum(context.textBytes, bytes, path);
  if (context.textBytes > JS_TEST_RESPONSE_LIMITS.maxTextBytes) throw invalid(path);
  return value;
}

function nullableString(
  value: unknown,
  path: string,
  context: DecodeContext,
  maxBytes: number,
): string | null {
  return value === null ? null : string(value, path, context, maxBytes);
}

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid(path);
  return value as number;
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  const result = count(value, path);
  if (result === 0) throw invalid(path);
  return result;
}

function nullableTime(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw invalid(path);
  return value;
}

function safeSum(left: number, right: number, path: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw invalid(path);
  return result;
}

function assertSuiteCounts(
  cases: readonly { readonly status: "passed" | "failed" | "error" | "skipped" }[],
  counts: {
    readonly errors: number;
    readonly failures: number;
    readonly skipped: number;
    readonly tests: number;
  },
  path: string,
): void {
  if (
    counts.tests !== cases.length ||
    counts.failures !== cases.filter(({ status }) => status === "failed").length ||
    counts.errors !== cases.filter(({ status }) => status === "error").length ||
    counts.skipped !== cases.filter(({ status }) => status === "skipped").length
  )
    throw invalid(path);
}

function assertAggregateCounts(
  suites: readonly {
    readonly errors: number;
    readonly failures: number;
    readonly skipped: number;
    readonly tests: number;
  }[],
  totals: {
    readonly errors: number;
    readonly failures: number;
    readonly skipped: number;
    readonly tests: number;
  },
): void {
  const aggregate = suites.reduce(
    (result, suite) => ({
      errors: safeSum(result.errors, suite.errors, "totals.errors"),
      failures: safeSum(result.failures, suite.failures, "totals.failures"),
      skipped: safeSum(result.skipped, suite.skipped, "totals.skipped"),
      tests: safeSum(result.tests, suite.tests, "totals.tests"),
    }),
    { errors: 0, failures: 0, skipped: 0, tests: 0 },
  );
  if (
    totals.tests !== aggregate.tests ||
    totals.failures !== aggregate.failures ||
    totals.errors !== aggregate.errors ||
    totals.skipped !== aggregate.skipped
  )
    throw invalid("totals");
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function invalid(path: string): Error {
  return new Error(`Invalid JavaScript test response at ${path}.`);
}
