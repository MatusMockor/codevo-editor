import { describe, expect, it, vi } from "vitest";
import type { PhpTestRunResponse } from "../domain/phpTestResults";
import { TauriPhpTestGateway } from "./tauriPhpTestGateway";

describe("TauriPhpTestGateway", () => {
  it("invokes the structured PHP test command with the workspace root", async () => {
    const response: PhpTestRunResponse = {
      status: "ok",
      suites: [],
      totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: null },
    };
    const invoke = vi.fn(async () => response);

    await expect(new TauriPhpTestGateway(invoke).run("/workspace")).resolves.toBe(
      response,
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_php_tests_junit", {
      filter: undefined,
      rootPath: "/workspace",
    });
  });

  it("passes a single test case filter as structured command data", async () => {
    const response: PhpTestRunResponse = {
      status: "ok",
      suites: [],
      totals: { errors: 0, failures: 0, skipped: 0, tests: 0, time: null },
    };
    const invoke = vi.fn(async () => response);

    await new TauriPhpTestGateway(invoke).run("/workspace", "testItWorks");

    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_php_tests_junit", {
      filter: "testItWorks",
      rootPath: "/workspace",
    });
  });
});
