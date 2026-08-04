import { describe, expect, it } from "vitest";
import { buildRunnerOptions } from "./runPerfScenariosCli.mjs";
import {
  PERF_AUTORUN_ENDPOINT_ENV,
  PERF_AUTORUN_RESULT_PATH,
  PERF_AUTORUN_RUNNER_PATH,
  PERF_AUTORUN_TOKEN_ENV,
  autorunRelayEndpoint,
  buildAutorunRunnerModule,
  parseAutorunPayload,
  perfAutorunRelayEnabled,
  runTokenMatches,
} from "./perfAutorunRelay.mjs";
import { PERF_AUTORUN_PATHS } from "../../src/components/perfAutorunEndpoints.ts";

function validResultPayload(overrides = {}) {
  return JSON.stringify({
    status: "ok",
    result: {
      bridgeResults: [{ id: "typing-large-5k", samples: [1, 2, 3] }],
      trackerSnapshot: [],
      failedPaths: [],
      ...overrides,
    },
  });
}

describe("perf autorun relay paths", () => {
  it("uses the exact paths the in-app trigger requests", () => {
    expect(PERF_AUTORUN_PATHS.runner).toBe(PERF_AUTORUN_RUNNER_PATH);
    expect(PERF_AUTORUN_PATHS.result).toBe(PERF_AUTORUN_RESULT_PATH);
  });

  it("keeps both relay paths same-origin absolute paths", () => {
    expect(PERF_AUTORUN_RUNNER_PATH.startsWith("/")).toBe(true);
    expect(PERF_AUTORUN_RESULT_PATH.startsWith("/")).toBe(true);
  });
});

describe("perfAutorunRelayEnabled", () => {
  it("is disabled without the autorun flag", () => {
    expect(perfAutorunRelayEnabled({ [PERF_AUTORUN_ENDPOINT_ENV]: "http://127.0.0.1:9999" })).toBe(
      false,
    );
  });

  it("is disabled without a driver endpoint", () => {
    expect(perfAutorunRelayEnabled({ VITE_CODEVO_PERF_AUTORUN: "1" })).toBe(false);
  });

  it("is disabled when the flag is any value other than 1", () => {
    expect(
      perfAutorunRelayEnabled({
        VITE_CODEVO_PERF_AUTORUN: "true",
        [PERF_AUTORUN_ENDPOINT_ENV]: "http://127.0.0.1:9999",
      }),
    ).toBe(false);
  });

  it("is disabled without this run's token", () => {
    expect(
      perfAutorunRelayEnabled({
        VITE_CODEVO_PERF_AUTORUN: "1",
        [PERF_AUTORUN_ENDPOINT_ENV]: "http://127.0.0.1:9999",
      }),
    ).toBe(false);
  });

  it("is enabled with the flag, the endpoint, and the run token", () => {
    expect(
      perfAutorunRelayEnabled({
        VITE_CODEVO_PERF_AUTORUN: "1",
        [PERF_AUTORUN_ENDPOINT_ENV]: "http://127.0.0.1:9999",
        [PERF_AUTORUN_TOKEN_ENV]: "run-token",
      }),
    ).toBe(true);
  });
});

describe("autorunRelayEndpoint", () => {
  it("reads the driver endpoint from the environment", () => {
    expect(autorunRelayEndpoint({ [PERF_AUTORUN_ENDPOINT_ENV]: "http://127.0.0.1:9999" })).toBe(
      "http://127.0.0.1:9999",
    );
  });

  it("returns an empty string when the endpoint is absent", () => {
    expect(autorunRelayEndpoint({})).toBe("");
  });
});

describe("buildAutorunRunnerModule", () => {
  it("wraps the shared in-page runner as an ES module with its options", () => {
    const options = buildRunnerOptions({ smoke: true, repoRoot: "/repo" });
    const source = buildAutorunRunnerModule(options, "run-token");

    expect(source).toContain("async function runCodevoPerfScenarios(options)");
    expect(source).toContain(`export const perfAutorunOptions = ${JSON.stringify(options)}`);
    expect(source).toContain("export default runCodevoPerfScenarios");
  });

  it("hands the page this run's token so it can authenticate its own post", async () => {
    const source = buildAutorunRunnerModule(
      buildRunnerOptions({ smoke: true, repoRoot: "/repo" }),
      'run-"token"',
    );
    const loaded = await import(
      `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`
    );

    expect(loaded.perfAutorunRunToken).toBe('run-"token"');
  });

  it("never embeds a bare import that the dev server would have to resolve", () => {
    const source = buildAutorunRunnerModule(
      buildRunnerOptions({ smoke: false, repoRoot: "/r" }),
      "run-token",
    );

    expect(/^import\s/m.test(source)).toBe(false);
  });

  it("emits a module the runtime can actually parse, run, and read options from", async () => {
    const options = buildRunnerOptions({ smoke: true, repoRoot: "/repo" });
    const source = buildAutorunRunnerModule(options, "run-token");
    const loaded = await import(
      `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`
    );

    expect(typeof loaded.default).toBe("function");
    expect(loaded.perfAutorunOptions).toEqual(options);

    globalThis.window = {};

    try {
      await expect(loaded.default({ waitMs: 1, intervalMs: 1 })).rejects.toThrow(/bridges/i);
    } finally {
      delete globalThis.window;
    }
  });
});

describe("runTokenMatches", () => {
  it("accepts the exact run token", () => {
    expect(runTokenMatches("2f1c-run-token", "2f1c-run-token")).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    expect(runTokenMatches("2f1c-run-tokeN", "2f1c-run-token")).toBe(false);
  });

  it("rejects a token of a different length", () => {
    expect(runTokenMatches("2f1c-run-token-extra", "2f1c-run-token")).toBe(false);
  });

  it("rejects an absent or non-string candidate", () => {
    expect(runTokenMatches(undefined, "2f1c-run-token")).toBe(false);
    expect(runTokenMatches(["2f1c-run-token"], "2f1c-run-token")).toBe(false);
  });

  it("rejects every candidate when no expected token exists", () => {
    expect(runTokenMatches("", "")).toBe(false);
    expect(runTokenMatches("anything", "")).toBe(false);
  });
});

describe("parseAutorunPayload", () => {
  it("accepts a well-formed result payload", () => {
    const parsed = parseAutorunPayload(validResultPayload());

    expect(parsed.kind).toBe("result");
    expect(parsed.result.bridgeResults).toEqual([{ id: "typing-large-5k", samples: [1, 2, 3] }]);
    expect(parsed.result.scenarioStatuses).toEqual([]);
  });

  it("accepts an error payload reported by the app", () => {
    const parsed = parseAutorunPayload(JSON.stringify({ status: "error", message: "boom" }));

    expect(parsed).toEqual({ kind: "error", message: "boom" });
  });

  it("rejects a truncated body", () => {
    const parsed = parseAutorunPayload('{"status":"ok","result":{"bridgeResu');

    expect(parsed.kind).toBe("invalid");
    expect(parsed.message).toMatch(/not valid JSON/);
  });

  it("rejects an unknown status", () => {
    const parsed = parseAutorunPayload(JSON.stringify({ status: "partial", result: {} }));

    expect(parsed.kind).toBe("invalid");
    expect(parsed.message).toMatch(/status/);
  });

  it("rejects an error payload without a message", () => {
    const parsed = parseAutorunPayload(JSON.stringify({ status: "error" }));

    expect(parsed.kind).toBe("invalid");
    expect(parsed.message).toMatch(/message/);
  });

  it("rejects a result payload that fails the shared runner-result validation", () => {
    const parsed = parseAutorunPayload(
      JSON.stringify({ status: "ok", result: { trackerSnapshot: [], failedPaths: [] } }),
    );

    expect(parsed.kind).toBe("invalid");
    expect(parsed.message).toMatch(/bridgeResults/);
  });

  it("rejects a JSON array body", () => {
    const parsed = parseAutorunPayload("[]");

    expect(parsed.kind).toBe("invalid");
    expect(parsed.message).toMatch(/object/);
  });
});
