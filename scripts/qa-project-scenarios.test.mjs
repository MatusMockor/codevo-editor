import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatActual,
  formatExpected,
  parseArgs,
  printPreflightResult,
  printRunResult,
  scenarios,
  selectScenarios,
  snippetFor,
  validateScenarioPreflight,
} from "./qa-project-scenarios.mjs";

describe("qa-project-scenarios CLI helpers", () => {
  const originalExitCode = process.exitCode;
  const tempDirs = [];

  afterEach(() => {
    process.exitCode = originalExitCode;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
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

  it("parses preflight with repeated selected scenarios", () => {
    const options = parseArgs([
      "--preflight",
      "--scenario",
      scenarios[0].id,
      "--scenario",
      scenarios[1].id,
    ]);

    expect(options.preflight).toBe(true);
    expect(selectScenarios(options).map((scenario) => scenario.id)).toEqual([
      scenarios[0].id,
      scenarios[1].id,
    ]);
  });

  it("prints snippets for multiple selected scenarios", () => {
    const selected = selectScenarios(
      parseArgs(["--scenario", scenarios[0].id, "--scenario", scenarios[1].id]),
    );
    const snippet = snippetFor(selected, 1234);

    expect(snippet).toContain(scenarios[0].id);
    expect(snippet).toContain(scenarios[1].id);
    expect(snippet).not.toContain(scenarios[2].id);
    expect(snippet).toContain('"occurrence":1');
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

  it("passes preflight when files and cursor anchor exist", () => {
    const root = makeTempProject();
    const activeFile = join(root, "app.php");
    const expectActiveFile = join(root, "target.php");
    writeFileSync(activeFile, "<?php\n$request->input();\n");
    writeFileSync(expectActiveFile, "<?php\n");

    const result = validateScenarioPreflight({
      action: "definition",
      activeFile,
      cursor: { after: "$request->" },
      expectActiveFile,
      id: "sample-definition",
      projectRoot: root,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.checks.find((check) => check.label === "cursor")).toMatchObject({
      count: 1,
      status: "PASS",
    });
  });

  it("fails preflight when active file or cursor anchor is missing", () => {
    const root = makeTempProject();
    const activeFile = join(root, "missing.php");

    const missingFile = validateScenarioPreflight({
      action: "completion",
      activeFile,
      cursor: { after: "$request->" },
      id: "missing-file",
      projectRoot: root,
    });

    expect(missingFile.ok).toBe(false);
    expect(missingFile.failures.join("\n")).toContain("activeFile does not exist");

    const existingFile = join(root, "existing.php");
    writeFileSync(existingFile, "<?php\n$response->json();\n");

    const missingAnchor = validateScenarioPreflight({
      action: "completion",
      activeFile: existingFile,
      cursor: { after: "$request->" },
      id: "missing-anchor",
      projectRoot: root,
    });

    expect(missingAnchor.ok).toBe(false);
    expect(missingAnchor.failures.join("\n")).toContain("cursor anchor matches 0 time(s)");
  });

  it("warns but passes preflight when cursor anchor is ambiguous", () => {
    const root = makeTempProject();
    const activeFile = join(root, "app.php");
    writeFileSync(activeFile, "<?php\n$request->input();\n$request->query();\n");

    const result = validateScenarioPreflight({
      action: "completion",
      activeFile,
      cursor: { after: "$request->" },
      id: "ambiguous-anchor",
      projectRoot: root,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("cursor anchor matches 2 time(s)");
  });

  it("passes preflight without warning when an ambiguous cursor occurrence is explicit", () => {
    const root = makeTempProject();
    const activeFile = join(root, "app.php");
    writeFileSync(activeFile, "<?php\n$request->input();\n$request->query();\n");

    const result = validateScenarioPreflight({
      action: "completion",
      activeFile,
      cursor: { after: "$request->", occurrence: 2 },
      id: "explicit-ambiguous-anchor",
      projectRoot: root,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.checks.find((check) => check.label === "cursor")).toMatchObject({
      count: 2,
      occurrence: 2,
      status: "PASS",
    });
  });

  it("sets a failing exit code when any preflight scenario fails", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    printPreflightResult([
      {
        action: "completion",
        activeFile: "/tmp/missing.php",
        checks: [
          {
            detail: "activeFile does not exist: /tmp/missing.php",
            label: "activeFile",
            ok: false,
            status: "FAIL",
          },
        ],
        failures: ["activeFile does not exist: /tmp/missing.php"],
        id: "sample",
        ok: false,
        projectRoot: "/tmp",
        warnings: [],
      },
    ]);

    expect(process.exitCode).toBe(1);
    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "Summary: 0/1 passed, 0 warned, 1 failed.",
    );
  });

  function makeTempProject() {
    const dir = mkdtempSync(join(tmpdir(), "qa-project-scenarios-"));
    tempDirs.push(dir);
    return dir;
  }
});
