import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/check-clippy-warning-budget.mjs");
const warning = {
  reason: "compiler-message",
  message: {
    level: "warning",
    message: "redundant closure",
    code: { code: "clippy::redundant_closure" },
    spans: [{ is_primary: true, file_name: "src/example.rs", line_start: 12, column_start: 3 }],
    rendered:
      "warning: redundant closure\n --> src/example.rs:12:3\nhelp: use the function directly\n",
  },
};

function check(messages, cargoStatus = 0, budget = "0") {
  const directory = mkdtempSync(join(tmpdir(), "codevo-clippy-budget-"));
  try {
    const cargo = join(directory, "cargo");
    writeFileSync(
      cargo,
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(messages.map((value) => JSON.stringify(value)).join("\n"))});\nprocess.exit(${cargoStatus});\n`,
    );
    chmodSync(cargo, 0o700);
    return spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        CLIPPY_WARNING_BUDGET: budget,
      },
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Clippy warning budget diagnostics", () => {
  it("reports the actual warning, location and fix when compilation passes but the budget fails", () => {
    const result = check([warning]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Clippy warning budget: 1/0");
    expect(result.stderr).toContain(warning.message.rendered);
  });

  it("does not count the same warning twice across Cargo targets", () => {
    const result = check([warning, warning], 0, "1");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Clippy warning budget: 1/1");
  });

  it("retains both warning and error details when Cargo fails", () => {
    const error = {
      reason: "compiler-message",
      message: { level: "error", message: "cannot compile", rendered: "error: cannot compile\n" },
    };
    const result = check([warning, error], 101);
    expect(result.status).toBe(101);
    expect(result.stderr).toContain(warning.message.rendered);
    expect(result.stderr).toContain(error.message.rendered);
  });

  it("passes clean output with the default zero-warning policy", () => {
    const result = check([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Clippy warning budget: 0/0");
  });
});
