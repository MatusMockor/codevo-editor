import { describe, expect, it } from "vitest";
import {
  languageServerDiagnosticNoticeGroup,
  languageServerDiagnosticNoticeMessage,
  languageServerDiagnosticNoticeSeverity,
  shouldApplyLanguageServerDiagnostics,
  type LanguageServerDiagnostic,
  type LanguageServerDiagnosticEvent,
} from "./languageServerDiagnostics";

describe("languageServerDiagnostics", () => {
  it("maps diagnostic severities to problem severities", () => {
    expect(languageServerDiagnosticNoticeSeverity("error")).toBe("error");
    expect(languageServerDiagnosticNoticeSeverity("warning")).toBe("warning");
    expect(languageServerDiagnosticNoticeSeverity("information")).toBe("info");
    expect(languageServerDiagnosticNoticeSeverity("hint")).toBe("info");
  });

  it("formats one-based diagnostic locations", () => {
    expect(
      languageServerDiagnosticNoticeMessage(
        diagnostic(),
        "file:///tmp/User.php",
      ),
    ).toBe(
      "file:///tmp/User.php 3:5 Unexpected token",
    );
  });

  it("builds stable notice groups per document uri", () => {
    expect(languageServerDiagnosticNoticeGroup("file:///tmp/User.php")).toBe(
      "language-server-diagnostics:file:///tmp/User.php",
    );
  });

  it("rejects diagnostics from stale sessions or older versions", () => {
    expect(shouldApplyLanguageServerDiagnostics(event(3), 1, 4)).toBe(false);
    expect(shouldApplyLanguageServerDiagnostics(event(4), 1, 4)).toBe(true);
    expect(shouldApplyLanguageServerDiagnostics(event(null), 1, 4)).toBe(true);
    expect(shouldApplyLanguageServerDiagnostics(event(4), 2, 4)).toBe(false);
  });
});

function diagnostic(): LanguageServerDiagnostic {
  return {
    character: 4,
    line: 2,
    message: "Unexpected token",
    severity: "error",
    source: "phpactor",
  };
}

function event(version: number | null): LanguageServerDiagnosticEvent {
  return {
    diagnostics: [diagnostic()],
    sessionId: 1,
    uri: "file:///tmp/User.php",
    version,
  };
}
