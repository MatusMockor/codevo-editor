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

  it("applies a clear (count=0) carrying the analysis version already applied", () => {
    // BUG 1: phpactor publishes diagnostics asynchronously keyed by the analysis
    // version (here v1), NOT the live document version (v2 after a didChange).
    // A clear (count=0) arriving at v1 — equal to the last APPLIED diagnostic
    // version — must still be applied so the stale "1 error" marker disappears.
    const lastAppliedDiagnosticVersion = 1;
    expect(
      shouldApplyLanguageServerDiagnostics(
        event(1),
        1,
        lastAppliedDiagnosticVersion,
      ),
    ).toBe(true);
  });

  it("applies a fresh phpactor publication newer than the last applied", () => {
    // No diagnostic applied yet (undefined) accepts any version.
    expect(shouldApplyLanguageServerDiagnostics(event(1), 1, undefined)).toBe(
      true,
    );
    // A strictly newer analysis version is always applied.
    expect(shouldApplyLanguageServerDiagnostics(event(2), 1, 1)).toBe(true);
  });

  it("drops a diagnostic older than the last applied diagnostic version", () => {
    // Protection: once a v2 diagnostic has been applied, a late v1 publication
    // for the same document must be dropped so it cannot resurrect stale state.
    expect(shouldApplyLanguageServerDiagnostics(event(1), 1, 2)).toBe(false);
  });

  it("rejects diagnostics from another workspace root", () => {
    expect(
      shouldApplyLanguageServerDiagnostics(
        event(4, "/workspace-a/"),
        1,
        4,
        "/workspace-a",
      ),
    ).toBe(true);
    expect(
      shouldApplyLanguageServerDiagnostics(
        event(4, "/workspace-a"),
        1,
        4,
        "/workspace-b",
      ),
    ).toBe(false);
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

function event(
  version: number | null,
  rootPath = "/tmp",
): LanguageServerDiagnosticEvent {
  return {
    diagnostics: [diagnostic()],
    rootPath,
    sessionId: 1,
    uri: "file:///tmp/User.php",
    version,
  };
}
