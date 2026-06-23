import { describe, expect, it } from "vitest";
import {
  isDiagnosticNotice,
  summarizeDiagnostics,
  summarizeDiagnosticsByPath,
} from "./diagnosticsSummary";

describe("diagnosticsSummary", () => {
  it("counts errors and warnings from diagnostic notices", () => {
    expect(
      summarizeDiagnostics([
        {
          groupKey: "language-server-diagnostics:file:///a.php",
          severity: "error",
        },
        {
          groupKey: "language-server-diagnostics:file:///a.php",
          severity: "warning",
        },
        {
          groupKey: "javascript-typescript-diagnostics:file:///b.ts",
          severity: "error",
        },
        {
          groupKey: "javascript-typescript-diagnostics:file:///b.ts",
          severity: "warning",
        },
        {
          groupKey: "javascript-typescript-diagnostics:file:///b.ts",
          severity: "warning",
        },
      ]),
    ).toEqual({ errors: 2, warnings: 3 });
  });

  it("ignores info-severity diagnostics and non-diagnostic notices", () => {
    expect(
      summarizeDiagnostics([
        {
          groupKey: "language-server-diagnostics:file:///a.php",
          severity: "info",
        },
        {
          groupKey: "language-server-status:something",
          severity: "error",
        },
        { severity: "error" },
        {
          groupKey: "javascript-typescript-diagnostics:file:///b.ts",
          severity: "error",
        },
      ]),
    ).toEqual({ errors: 1, warnings: 0 });
  });

  it("returns zero counts for empty input", () => {
    expect(summarizeDiagnostics([])).toEqual({ errors: 0, warnings: 0 });
  });

  it("counts errors and warnings across diagnostics keyed by path", () => {
    // The status-bar count must reflect ALL diagnostics from the (uncapped)
    // marker source, so it stays truthful even when the notices panel is
    // capped. information/hint severities are not counted (parity with the
    // notice severity mapping).
    expect(
      summarizeDiagnosticsByPath({
        "/a.php": [
          { severity: "error" },
          { severity: "warning" },
          { severity: "information" },
          { severity: "hint" },
        ],
        "/b.ts": [{ severity: "error" }, { severity: "error" }],
      }),
    ).toEqual({ errors: 3, warnings: 1 });
  });

  it("returns zero counts for an empty diagnostics-by-path map", () => {
    expect(summarizeDiagnosticsByPath({})).toEqual({ errors: 0, warnings: 0 });
  });

  it("recognizes diagnostic notices by their group key prefix", () => {
    expect(
      isDiagnosticNotice({
        groupKey: "language-server-diagnostics:file:///a.php",
        severity: "error",
      }),
    ).toBe(true);
    expect(
      isDiagnosticNotice({
        groupKey: "javascript-typescript-diagnostics:file:///b.ts",
        severity: "warning",
      }),
    ).toBe(true);
    expect(isDiagnosticNotice({ groupKey: "index:scan", severity: "error" })).toBe(
      false,
    );
    expect(isDiagnosticNotice({ severity: "error" })).toBe(false);
  });
});
