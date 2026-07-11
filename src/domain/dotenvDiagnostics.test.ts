import { describe, expect, it } from "vitest";
import { dotenvDiagnosticsFromSource } from "./dotenvDiagnostics";

describe("dotenvDiagnosticsFromSource", () => {
  it("returns no diagnostics when keys are unique", () => {
    expect(dotenvDiagnosticsFromSource("APP_NAME=Codevo\nAPP_ENV=local\n")).toEqual(
      [],
    );
  });

  it("warns on the first occurrence of a duplicated key", () => {
    expect(
      dotenvDiagnosticsFromSource(" APP_NAME=Codevo\nAPP_NAME=Editor\n"),
    ).toEqual([
      {
        character: 1,
        endCharacter: 9,
        endLine: 0,
        line: 0,
        message: "Duplicate key APP_NAME — overridden by a later assignment",
        severity: "warning",
        source: "dotenv",
      },
    ]);
  });

  it("warns on every occurrence except the last", () => {
    expect(
      dotenvDiagnosticsFromSource("APP_ENV=local\nAPP_ENV=test\nAPP_ENV=production"),
    ).toEqual([
      expect.objectContaining({ character: 0, endCharacter: 7, line: 0 }),
      expect.objectContaining({ character: 0, endCharacter: 7, line: 1 }),
    ]);
  });

  it("ignores commented-out duplicate assignments", () => {
    expect(
      dotenvDiagnosticsFromSource(
        "# APP_KEY=commented\n  # APP_KEY=also-commented\nAPP_KEY=active\n",
      ),
    ).toEqual([]);
  });

  it("matches keys case-sensitively", () => {
    expect(dotenvDiagnosticsFromSource("APP_KEY=one\napp_key=two\n")).toEqual(
      [],
    );
  });

  it("reports exact key ranges for export assignments and CRLF input", () => {
    expect(
      dotenvDiagnosticsFromSource(
        "  export QUEUE_CONNECTION=sync\r\nQUEUE_CONNECTION=database\r\n",
      ),
    ).toEqual([
      expect.objectContaining({
        character: 9,
        endCharacter: 25,
        endLine: 0,
        line: 0,
      }),
    ]);
  });
});
