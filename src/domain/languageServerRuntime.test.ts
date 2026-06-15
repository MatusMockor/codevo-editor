import { describe, expect, it } from "vitest";
import {
  isLanguageServerActive,
  languageServerCrashMessage,
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "./languageServerRuntime";

describe("languageServerStatusLabel", () => {
  it("labels active and crashed states", () => {
    expect(languageServerStatusLabel(null)).toBeNull();
    expect(languageServerStatusLabel(status("starting"))).toBe(
      "PHPactor: starting",
    );
    expect(languageServerStatusLabel(status("running"))).toBe(
      "PHPactor: running",
    );
    expect(languageServerStatusLabel(crashed("boom"))).toBe(
      "PHPactor: crashed",
    );
    expect(languageServerStatusLabel(status("stopped"))).toBeNull();
  });
});

describe("languageServerCrashMessage", () => {
  it("returns crash messages only for crashed states", () => {
    expect(languageServerCrashMessage(crashed("boom"))).toBe("boom");
    expect(languageServerCrashMessage(status("running"))).toBeNull();
  });
});

describe("isLanguageServerActive", () => {
  it("treats starting and running as active", () => {
    expect(isLanguageServerActive(status("starting"))).toBe(true);
    expect(isLanguageServerActive(status("running"))).toBe(true);
    expect(isLanguageServerActive(status("stopped"))).toBe(false);
    expect(isLanguageServerActive(crashed("boom"))).toBe(false);
    expect(isLanguageServerActive(null)).toBe(false);
  });
});

function status(
  kind: Exclude<LanguageServerRuntimeStatus["kind"], "crashed">,
): LanguageServerRuntimeStatus {
  if (kind === "starting" || kind === "running") {
    return { kind, sessionId: 1 };
  }

  return { kind };
}

function crashed(message: string): LanguageServerRuntimeStatus {
  return { kind: "crashed", message };
}
