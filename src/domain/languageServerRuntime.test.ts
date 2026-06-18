import { describe, expect, it } from "vitest";
import {
  emptyLanguageServerCapabilities,
  isLanguageServerActive,
  languageServerCapabilityLabels,
  languageServerCapabilities,
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

describe("languageServerCapabilities", () => {
  it("returns running capabilities or an empty registry", () => {
    expect(languageServerCapabilities(status("running"))).toEqual({
      codeAction: true,
      completion: true,
      definition: true,
      documentHighlight: true,
      documentSymbol: true,
      formatting: true,
      hover: true,
      implementation: true,
      inlayHint: true,
      references: true,
      rename: true,
      selectionRange: true,
      signatureHelp: true,
      workspaceSymbol: true,
    });
    expect(languageServerCapabilities(status("starting"))).toEqual(
      emptyLanguageServerCapabilities(),
    );
    expect(languageServerCapabilities(null)).toEqual(
      emptyLanguageServerCapabilities(),
    );
  });

  it("returns labels for enabled capabilities", () => {
    expect(languageServerCapabilityLabels(status("running"))).toEqual([
      "hover",
      "completion",
      "definition",
      "document symbols",
      "document highlights",
      "implementation",
      "inlay hints",
      "references",
      "rename",
      "smart selection",
      "signature help",
      "workspace symbols",
      "code actions",
      "formatting",
    ]);
    expect(languageServerCapabilityLabels(status("starting"))).toEqual([]);
  });
});

function status(
  kind: Exclude<LanguageServerRuntimeStatus["kind"], "crashed">,
): LanguageServerRuntimeStatus {
  if (kind === "starting" || kind === "running") {
    if (kind === "running") {
      return {
        kind,
        sessionId: 1,
        capabilities: {
          codeAction: true,
          completion: true,
          definition: true,
          documentHighlight: true,
          documentSymbol: true,
          formatting: true,
          hover: true,
          implementation: true,
          inlayHint: true,
          references: true,
          rename: true,
          selectionRange: true,
          signatureHelp: true,
          workspaceSymbol: true,
        },
      };
    }

    return { kind, sessionId: 1 };
  }

  return { kind };
}

function crashed(message: string): LanguageServerRuntimeStatus {
  return { kind: "crashed", message };
}
