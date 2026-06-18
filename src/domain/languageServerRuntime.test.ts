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
      callHierarchy: true,
      codeAction: true,
      codeLens: true,
      completion: true,
      definition: true,
      documentHighlight: true,
      documentLink: true,
      documentSymbol: true,
      foldingRange: true,
      formatting: true,
      hover: true,
      implementation: true,
      inlayHint: true,
      linkedEditingRange: true,
      onTypeFormatting: true,
      prepareRename: true,
      rangeFormatting: true,
      references: true,
      rename: true,
      selectionRange: true,
      semanticTokens: true,
      signatureHelp: true,
      typeDefinition: true,
      willRenameFiles: true,
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
      "call hierarchy",
      "hover",
      "completion",
      "definition",
      "document symbols",
      "document highlights",
      "document links",
      "folding",
      "implementation",
      "inlay hints",
      "linked editing",
      "on-type formatting",
      "prepare rename",
      "range formatting",
      "references",
      "rename",
      "smart selection",
      "semantic tokens",
      "signature help",
      "type definition",
      "file rename edits",
      "workspace symbols",
      "code actions",
      "code lens",
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
          callHierarchy: true,
          codeAction: true,
          codeLens: true,
          completion: true,
          definition: true,
          documentHighlight: true,
          documentLink: true,
          documentSymbol: true,
          foldingRange: true,
          formatting: true,
          hover: true,
          implementation: true,
          inlayHint: true,
          linkedEditingRange: true,
          onTypeFormatting: true,
          prepareRename: true,
          rangeFormatting: true,
          references: true,
          rename: true,
          selectionRange: true,
          semanticTokens: true,
          signatureHelp: true,
          typeDefinition: true,
          willRenameFiles: true,
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
