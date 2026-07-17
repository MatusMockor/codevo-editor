import { describe, expect, it, vi } from "vitest";
import type { TestRunResponse } from "../domain/testResults";
import { TauriJsTestGateway } from "./tauriJsTestGateway";

describe("TauriJsTestGateway", () => {
  it("invokes the structured JS test command with the workspace root", async () => {
    const response: TestRunResponse = {
      status: "ok",
      suites: [],
      totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: null },
    };
    const invoke = vi.fn(async () => response);

    await expect(new TauriJsTestGateway(invoke).run("/workspace")).resolves.toBe(
      response,
    );
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
});
