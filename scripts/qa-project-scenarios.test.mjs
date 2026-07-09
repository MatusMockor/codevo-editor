import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatActual,
  formatExpected,
  parseArgs,
  printRunResult,
  scenarios,
  selectScenarios,
  snippetFor,
} from "./qa-project-scenarios.mjs";

describe("qa-project-scenarios CLI helpers", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("selects every built-in scenario with --all", () => {
    const options = parseArgs(["--all", "--print-snippet"]);

    expect(selectScenarios(options).map((scenario) => scenario.id)).toEqual(
      scenarios.map((scenario) => scenario.id),
    );
  });

  it("rejects mixing --all with explicit scenarios", () => {
    expect(() => parseArgs(["--all", "--scenario", scenarios[0].id])).toThrow(
      "Use --all or --scenario, not both.",
    );
  });

  it("prints snippets for multiple selected scenarios", () => {
    const selected = selectScenarios(
      parseArgs(["--scenario", scenarios[0].id, "--scenario", scenarios[1].id]),
    );
    const snippet = snippetFor(selected, 1234);

    expect(snippet).toContain(scenarios[0].id);
    expect(snippet).toContain(scenarios[1].id);
    expect(snippet).not.toContain(scenarios[2].id);
    expect(snippet).toContain('"timeoutMs":1234');
  });

  it("formats expected and actual report fields", () => {
    expect(
      formatExpected({
        action: "completion",
        expectedLabels: ["authenticate", "session"],
        minItems: 1,
      }),
    ).toBe("labels [authenticate, session], minItems 1");

    expect(
      formatActual({
        action: "definition",
        actualActiveFile: "/tmp/routes/auth.php",
      }),
    ).toBe("/tmp/routes/auth.php");
  });

  it("sets a failing exit code when any scenario fails", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    printRunResult([
      {
        action: "completion",
        activeFile: "/tmp/source.php",
        actualLabels: ["authenticate"],
        expectedLabels: ["authenticate", "session"],
        id: "sample",
        itemCount: 1,
        message: "Missing completion labels: session.",
        minItems: 1,
        ok: false,
      },
    ]);

    expect(process.exitCode).toBe(1);
    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "Summary: 0/1 passed, 1 failed.",
    );
  });
});
