import { describe, expect, it, vi } from "vitest";
import { MAX_JS_TEST_OUTPUT_STREAM_BYTES } from "../domain/jsTestTask";
import type { TestRunResponse } from "../domain/testResults";
import { JS_TEST_RESPONSE_LIMITS, TauriJsTestGateway } from "./tauriJsTestGateway";

describe("TauriJsTestGateway", () => {
  it("matches the native JavaScript test projection budgets", () => {
    expect(JS_TEST_RESPONSE_LIMITS).toEqual({
      maxCases: 5_000,
      maxMessageBytes: 64 * 1024,
      maxNameBytes: 16 * 1024,
      maxPathBytes: 16 * 1024,
      maxSuites: 5_000,
      maxTextBytes: 16 * 1024 * 1024,
    });
  });

  it("invokes the structured JS test command with the workspace root", async () => {
    const response: TestRunResponse = {
      status: "ok",
      suites: [],
      totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: null },
    };
    const invoke = vi.fn(async () => response);

    await expect(new TauriJsTestGateway(invoke).run("/workspace")).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_js_tests_json", {
      filter: undefined,
      rootPath: "/workspace",
    });
  });

  it("passes a single test case filter as structured command data", async () => {
    const response: TestRunResponse = {
      status: "ok",
      suites: [],
      totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: null },
    };
    const invoke = vi.fn(async () => response);

    await new TauriJsTestGateway(invoke).run("/workspace", "adds two numbers");

    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_js_tests_json", {
      filter: "adds two numbers",
      rootPath: "/workspace",
    });
  });

  it.each([
    { kind: "all" as const },
    { kind: "file" as const, relativeFilePath: "src/math.test.ts" },
    { kind: "suite" as const, relativeFilePath: "src/math.test.ts", fullName: "math" },
    { kind: "test" as const, relativeFilePath: "src/math.test.ts", fullName: "math adds" },
  ])("passes a validated $kind scope to the scoped command", async (scope) => {
    const response: TestRunResponse = {
      status: "ok",
      suites: [],
      totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: null },
    };
    const invoke = vi.fn(async () => response);

    await new TauriJsTestGateway(invoke).run("/workspace", scope);

    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_js_tests_scoped_json", {
      packageRootRelativePath: "",
      rootPath: "/workspace",
      scope,
    });
  });

  it("dispatches a validated nested-package authority without absolute execution paths", async () => {
    const response = ok([]);
    const invoke = vi.fn(async () => response);
    const gateway = new TauriJsTestGateway(invoke);

    await gateway.run(
      "/workspace",
      { kind: "file", relativeFilePath: "packages/web/src/app.test.ts" },
      { packageRootRelativePath: "packages/web" },
    );

    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_js_tests_scoped_json", {
      packageRootRelativePath: "packages/web",
      rootPath: "/workspace",
      scope: { kind: "file", relativeFilePath: "packages/web/src/app.test.ts" },
    });
    await expect(
      gateway.run(
        "/workspace",
        { kind: "file", relativeFilePath: "packages/web/src/app.test.ts" },
        { packageRootRelativePath: "/tmp/package" },
      ),
    ).rejects.toThrow("workspace-confined relative path");
  });

  it("rejects malformed wire responses instead of trusting an assertion", async () => {
    const gateway = new TauriJsTestGateway(async () => ({
      status: "ok",
      suites: [{ name: "a", cases: [{ status: "mystery" }] }],
      totals: { tests: 1 },
    }));

    await expect(gateway.run("/workspace", { kind: "all" })).rejects.toThrow(
      "Invalid JavaScript test response",
    );
  });

  it("strictly decodes a complete result response", async () => {
    const response: TestRunResponse = {
      status: "ok",
      suites: [
        {
          name: "src/math.test.ts",
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          time: 0.1,
          cases: [
            {
              name: "math adds",
              classname: "math",
              file: "/workspace/src/math.test.ts",
              line: 2,
              time: 0.1,
              status: "passed",
              message: null,
            },
          ],
        },
      ],
      totals: { tests: 1, failures: 0, errors: 0, skipped: 0, time: 0.1 },
    };
    const gateway = new TauriJsTestGateway(async () => response);

    await expect(gateway.run("/workspace", { kind: "all" })).resolves.toEqual(response);
  });

  it("accepts the native 5,000 suite and case boundaries and rejects one more", async () => {
    const emptySuite = suite([]);
    const suitesAtLimit = Array.from(
      { length: JS_TEST_RESPONSE_LIMITS.maxSuites },
      () => emptySuite,
    );
    await expect(runResponse(ok(suitesAtLimit))).resolves.toMatchObject({
      suites: { length: JS_TEST_RESPONSE_LIMITS.maxSuites },
    });
    await expect(runResponse(ok([...suitesAtLimit, emptySuite]))).rejects.toThrow(
      "Invalid JavaScript test response at suites",
    );

    const casesAtLimit = Array.from({ length: JS_TEST_RESPONSE_LIMITS.maxCases }, (_, index) =>
      testCase({ name: `case ${index}` }),
    );
    await expect(runResponse(ok([suite(casesAtLimit)]))).resolves.toMatchObject({
      totals: { tests: JS_TEST_RESPONSE_LIMITS.maxCases },
    });
    await expect(
      runResponse(ok([suite([...casesAtLimit, testCase({ name: "overflow" })])])),
    ).rejects.toThrow("Invalid JavaScript test response at suites[0].cases");
  });

  it("enforces exact field and aggregate UTF-8 response boundaries", async () => {
    const maximumName = "x".repeat(JS_TEST_RESPONSE_LIMITS.maxNameBytes);
    await expect(runResponse(ok([suite([], maximumName)]))).resolves.toMatchObject({
      suites: [{ name: maximumName }],
    });
    await expect(runResponse(ok([suite([], `${maximumName}x`)]))).rejects.toThrow("suites[0].name");

    const maximumPath = "p".repeat(JS_TEST_RESPONSE_LIMITS.maxPathBytes);
    await expect(
      runResponse(ok([suite([testCase({ file: maximumPath })])])),
    ).resolves.toMatchObject({ suites: [{ cases: [{ file: maximumPath }] }] });
    await expect(runResponse(ok([suite([testCase({ file: `${maximumPath}p` })])]))).rejects.toThrow(
      "suites[0].cases[0].file",
    );

    await expect(
      runResponse(ok([suite([testCase({ name: maximumName })])])),
    ).resolves.toMatchObject({ suites: [{ cases: [{ name: maximumName }] }] });
    await expect(runResponse(ok([suite([testCase({ name: `${maximumName}x` })])]))).rejects.toThrow(
      "suites[0].cases[0].name",
    );

    const maximumMessage = "x".repeat(JS_TEST_RESPONSE_LIMITS.maxMessageBytes);
    await expect(
      runResponse(ok([suite([testCase({ message: maximumMessage, status: "failed" })])])),
    ).resolves.toMatchObject({ suites: [{ cases: [{ message: maximumMessage }] }] });
    await expect(
      runResponse(ok([suite([testCase({ message: `${maximumMessage}x`, status: "failed" })])])),
    ).rejects.toThrow("suites[0].cases[0].message");

    const aggregateCases = Array.from(
      { length: Math.floor(JS_TEST_RESPONSE_LIMITS.maxTextBytes / maximumName.length) + 1 },
      () => testCase({ name: maximumName }),
    );
    await expect(runResponse(ok([suite(aggregateCases)]))).rejects.toThrow(
      /suites\[0\]\.cases\[\d+\]\.name/,
    );

    await expect(runResponse({ status: "error", message: `${maximumMessage}x` })).rejects.toThrow(
      "Invalid JavaScript test response at message",
    );
  });

  it("requires exact closed native shapes and primitive statuses", async () => {
    await expect(runResponse({ ...ok([]), unexpected: true })).rejects.toThrow(
      "Invalid JavaScript test response at unexpected",
    );
    const missingMessage = testCase();
    delete (missingMessage as Partial<typeof missingMessage>).message;
    await expect(runResponse(ok([suite([missingMessage])]))).rejects.toThrow(
      "Invalid JavaScript test response at message",
    );
    await expect(
      runResponse(ok([suite([testCase({ status: new String("passed") })])])),
    ).rejects.toThrow("suites[0].cases[0].status");
  });

  it("rejects unsafe integers, malformed Unicode, and impossible native aggregates", async () => {
    await expect(
      runResponse(ok([suite([testCase({ line: Number.MAX_SAFE_INTEGER + 1 })])])),
    ).rejects.toThrow("suites[0].cases[0].line");
    await expect(
      runResponse(ok([suite([testCase({ name: String.fromCharCode(0xd800) })])])),
    ).rejects.toThrow("suites[0].cases[0].name");
    await expect(
      runResponse({
        ...ok([suite([testCase()])]),
        totals: { tests: 0, failures: 0, errors: 0, skipped: 0, time: null },
      }),
    ).rejects.toThrow("Invalid JavaScript test response at totals");
    await expect(
      runResponse(
        ok([
          {
            ...suite([testCase()]),
            failures: 1,
          },
        ]),
      ),
    ).rejects.toThrow("Invalid JavaScript test response at suites[0]");
  });

  it("invokes the owner-bound task command with only validated canonical request keys", async () => {
    const invoke = vi.fn(async () => taskEnvelope(ok([])));
    const gateway = new TauriJsTestGateway(invoke);

    await expect(
      gateway.runTask({
        packageRootRelativePath: "packages/web",
        runId: "run-1",
        workspaceId: "workspace-1",
        scope: { kind: "all", ignored: true } as never,
        ignored: true,
      } as never),
    ).resolves.toEqual(taskEnvelope(ok([])));

    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_js_test_task_json", {
      request: {
        packageRootRelativePath: "packages/web",
        runId: "run-1",
        workspaceId: "workspace-1",
        scope: { kind: "all" },
      },
    });
  });

  it.each([
    { status: "error" as const, message: "Runner failed" },
    { status: "unavailable" as const, message: "Runner unavailable" },
    { status: "cancelled" as const },
  ])("strictly decodes an owner-echoed $status task terminal response", async (response) => {
    const envelope = taskEnvelope(response, taskOutput("out", "err"));
    const gateway = new TauriJsTestGateway(async () => envelope);

    await expect(
      gateway.runTask({
        runId: "run-1",
        workspaceId: "workspace-1",
        scope: { kind: "all" },
      }),
    ).resolves.toEqual(envelope);
  });

  it("reuses the bounded result decoder inside the task envelope", async () => {
    const maximumMessage = "x".repeat(JS_TEST_RESPONSE_LIMITS.maxMessageBytes);
    const valid = ok([suite([testCase({ message: maximumMessage, status: "failed" })])]);
    const gateway = (response: unknown) =>
      new TauriJsTestGateway(async () => taskEnvelope(response));
    const request = {
      runId: "run-1",
      workspaceId: "workspace-1",
      scope: { kind: "all" as const },
    };

    await expect(gateway(valid).runTask(request)).resolves.toEqual(taskEnvelope(valid));
    await expect(
      gateway({
        ...valid,
        suites: [
          suite([
            testCase({
              message: `${maximumMessage}x`,
              status: "failed",
            }),
          ]),
        ],
      }).runTask(request),
    ).rejects.toThrow("suites[0].cases[0].message");
  });

  it("accepts exact output UTF-8 byte boundaries without slicing and freezes the snapshot", async () => {
    const boundary = "🙂".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES / 4);
    const envelope = taskEnvelope(ok([]), {
      stdout: { text: boundary, truncated: true },
      stderr: { text: "e".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES), truncated: false },
    });
    const result = await new TauriJsTestGateway(async () => envelope).runTask(taskRequest());

    expect(result).toEqual(envelope);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.owner)).toBe(true);
    expect(Object.isFrozen(result.output)).toBe(true);
    expect(Object.isFrozen(result.output.stdout)).toBe(true);
    expect(Object.isFrozen(result.output.stderr)).toBe(true);
  });

  it.each([
    {
      label: "oversized ASCII stdout",
      mutate: (envelope: ReturnType<typeof taskEnvelope>) => {
        envelope.output.stdout.text = "x".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES + 1);
      },
      path: "output.stdout.text",
    },
    {
      label: "oversized multibyte stderr",
      mutate: (envelope: ReturnType<typeof taskEnvelope>) => {
        envelope.output.stderr.text = "🙂".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES / 4 + 1);
      },
      path: "output.stderr.text",
    },
    {
      label: "malformed Unicode",
      mutate: (envelope: ReturnType<typeof taskEnvelope>) => {
        envelope.output.stdout.text = String.fromCharCode(0xd800);
      },
      path: "output.stdout.text",
    },
    {
      label: "boxed text",
      mutate: (envelope: ReturnType<typeof taskEnvelope>) => {
        envelope.output.stderr.text = new String("err") as never;
      },
      path: "output.stderr.text",
    },
    {
      label: "non-boolean truncation",
      mutate: (envelope: ReturnType<typeof taskEnvelope>) => {
        envelope.output.stdout.truncated = 1 as never;
      },
      path: "output.stdout.truncated",
    },
    {
      label: "extra stream key",
      mutate: (envelope: ReturnType<typeof taskEnvelope>) => {
        (envelope.output.stderr as Record<string, unknown>).extra = true;
      },
      path: "extra",
    },
  ])("rejects $label rather than partially accepting output", async ({ mutate, path }) => {
    const envelope = taskEnvelope(ok([]));
    mutate(envelope);
    const gateway = new TauriJsTestGateway(async () => envelope);

    await expect(gateway.runTask(taskRequest())).rejects.toThrow(
      `Invalid JavaScript test response at ${path}`,
    );
  });

  it.each([
    {
      owner: { runId: "other-run", workspaceId: "workspace-1" },
      response: ok([]),
      output: taskOutput(),
    },
    {
      owner: { runId: "run-1", workspaceId: "other-owner" },
      response: ok([]),
      output: taskOutput(),
    },
    { owner: { runId: "", workspaceId: "workspace-1" }, response: ok([]), output: taskOutput() },
    {
      owner: TASK_OWNER,
      response: { status: "cancelled", message: "extra" },
      output: taskOutput(),
    },
    { owner: TASK_OWNER, response: { status: "error" }, output: taskOutput() },
    { owner: { ...TASK_OWNER, extra: true }, response: ok([]), output: taskOutput() },
    { owner: TASK_OWNER, response: ok([]), output: taskOutput(), extra: true },
    { owner: TASK_OWNER, response: ok([]) },
    { owner: TASK_OWNER, output: taskOutput() },
    { response: ok([]), output: taskOutput() },
    null,
  ])("fails closed for malformed or cross-owner task run envelope %#", async (response) => {
    const gateway = new TauriJsTestGateway(async () => response);

    await expect(gateway.runTask(taskRequest())).rejects.toThrow(
      "Invalid JavaScript test response",
    );
  });

  it("rejects malformed task request IDs and scopes before invoking native code", async () => {
    const invoke = vi.fn();
    const gateway = new TauriJsTestGateway(invoke);

    await expect(
      gateway.runTask({
        runId: "line\nbreak",
        workspaceId: "workspace-1",
        scope: { kind: "all" },
      }),
    ).rejects.toThrow(/runId/);
    await expect(
      gateway.runTask({
        runId: "run-1",
        workspaceId: "x".repeat(65),
        scope: { kind: "all" },
      }),
    ).rejects.toThrow(/workspaceId/);
    await expect(
      gateway.runTask({
        runId: "run-1",
        workspaceId: "workspace-1",
        scope: { kind: "bogus" } as never,
      }),
    ).rejects.toThrow(/scope kind/);
    await expect(
      gateway.runTask({
        runId: "run-1",
        workspaceId: "workspace-1",
        scope: { kind: "file", relativeFilePath: "../outside.test.ts" },
      }),
    ).rejects.toThrow(/workspace/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "invokes stop with an exact owner and decodes stopped=%s",
    async (stopped) => {
      const invoke = vi.fn(async () => ({ runId: "r".repeat(64), stopped }));
      const gateway = new TauriJsTestGateway(invoke);

      await expect(
        gateway.stopTask({
          runId: "r".repeat(64),
          workspaceId: "w".repeat(64),
          ignored: true,
        } as never),
      ).resolves.toBe(stopped);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("stop_js_test_task", {
        request: {
          runId: "r".repeat(64),
          workspaceId: "w".repeat(64),
        },
      });
    },
  );

  it.each([
    { runId: "other-run", stopped: true },
    { runId: "run-1", stopped: 1 },
    { runId: "run-1", stopped: true, extra: false },
    { runId: "run-1" },
    { stopped: true },
    false,
  ])("fails closed for malformed stop response %#", async (response) => {
    const gateway = new TauriJsTestGateway(async () => response);

    await expect(gateway.stopTask({ runId: "run-1", workspaceId: "workspace-1" })).rejects.toThrow(
      "Invalid JavaScript test response",
    );
  });
});

function runResponse(response: unknown) {
  return new TauriJsTestGateway(async () => response).run("/workspace", { kind: "all" });
}

const TASK_OWNER = { runId: "run-1", workspaceId: "workspace-1" };

function taskRequest() {
  return { ...TASK_OWNER, scope: { kind: "all" as const } };
}

function taskOutput(stdout = "", stderr = "") {
  return {
    stdout: { text: stdout, truncated: false },
    stderr: { text: stderr, truncated: false },
  };
}

function taskEnvelope(response: unknown, output = taskOutput()) {
  return {
    owner: { ...TASK_OWNER },
    output,
    response,
  };
}

function ok(suites: ReturnType<typeof suite>[]) {
  const cases = suites.flatMap((candidate) => candidate.cases);
  return {
    status: "ok",
    suites,
    totals: {
      tests: cases.length,
      failures: cases.filter(({ status }) => status === "failed").length,
      errors: cases.filter(({ status }) => status === "error").length,
      skipped: cases.filter(({ status }) => status === "skipped").length,
      time: null,
    },
  };
}

function suite(cases: ReturnType<typeof testCase>[], name: string | null = null) {
  return {
    name,
    tests: cases.length,
    failures: cases.filter(({ status }) => status === "failed").length,
    errors: cases.filter(({ status }) => status === "error").length,
    skipped: cases.filter(({ status }) => status === "skipped").length,
    time: null,
    cases,
  };
}

function testCase(overrides: Record<string, unknown> = {}) {
  return {
    name: "case",
    classname: null,
    file: null,
    line: null,
    time: null,
    status: "passed",
    message: null,
    ...overrides,
  };
}
