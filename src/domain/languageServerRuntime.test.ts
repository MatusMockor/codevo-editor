import { describe, expect, it } from "vitest";
import {
  emptyLanguageServerCapabilities,
  isLanguageServerActive,
  languageServerCapabilityLabels,
  languageServerCapabilities,
  languageServerCrashMessage,
  languageServerStatusBelongsToWorkspace,
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

  it("labels rooted TypeScript server states as project-local", () => {
    expect(languageServerStatusLabel(status("starting", "/workspace"), "TS Server")).toBe(
      "TS Server: starting for this project",
    );
    expect(languageServerStatusLabel(status("running", "/workspace"), "TS Server")).toBe(
      "TS Server: running for this project",
    );
    expect(languageServerStatusLabel(crashed("boom", "/workspace"), "TS Server")).toBe(
      "TS Server: crashed for this project",
    );
  });

  it("suppresses labels from another workspace root when a root is provided", () => {
    const runningStatus = status("running", "/workspace-a");

    expect(
      languageServerStatusLabel(runningStatus, "TS Server", {
        workspaceRoot: "/workspace-a/",
      }),
    ).toBe("TS Server: running for this project");
    expect(
      languageServerStatusLabel(runningStatus, "TS Server", {
        workspaceRoot: "/workspace-b",
      }),
    ).toBeNull();
    expect(
      languageServerStatusLabel(status("running"), "TS Server", {
        workspaceRoot: "/workspace-a",
      }),
    ).toBeNull();
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

describe("languageServerStatusBelongsToWorkspace", () => {
  it("matches rooted statuses against normalized workspace roots", () => {
    expect(
      languageServerStatusBelongsToWorkspace(
        status("running", "/workspace-a/"),
        "/workspace-a",
      ),
    ).toBe(true);
    expect(
      languageServerStatusBelongsToWorkspace(
        status("running", "/workspace-a"),
        "/workspace-b",
      ),
    ).toBe(false);
    expect(
      languageServerStatusBelongsToWorkspace(status("running"), "/workspace-b"),
    ).toBe(false);
    expect(languageServerStatusBelongsToWorkspace(status("running"), null)).toBe(
      true,
    );
  });
});

describe("languageServerCapabilities", () => {
  it("returns running capabilities or an empty registry", () => {
    expect(languageServerCapabilities(status("running"))).toEqual({
      callHierarchy: true,
      codeAction: true,
      codeLens: true,
      completion: true,
      declaration: true,
      definition: true,
      documentHighlight: true,
      documentLink: true,
      documentSymbol: true,
      didRenameFiles: true,
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
      sourceDefinition: true,
      typeDefinition: true,
      typeHierarchy: true,
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
      "declaration",
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
      "source definition",
      "type definition",
      "type hierarchy",
      "file rename edits",
      "file rename notifications",
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
  rootPath?: string,
): LanguageServerRuntimeStatus {
  if (kind === "starting" || kind === "running") {
    if (kind === "running") {
      return {
        kind,
        rootPath,
        sessionId: 1,
        capabilities: {
          callHierarchy: true,
          codeAction: true,
          codeLens: true,
          completion: true,
          declaration: true,
          definition: true,
          documentHighlight: true,
          documentLink: true,
          documentSymbol: true,
          didRenameFiles: true,
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
          sourceDefinition: true,
          typeDefinition: true,
          typeHierarchy: true,
          willRenameFiles: true,
          workspaceSymbol: true,
        },
      };
    }

    return { kind, rootPath, sessionId: 1 };
  }

  return { kind, rootPath };
}

function crashed(message: string, rootPath?: string): LanguageServerRuntimeStatus {
  return { kind: "crashed", message, rootPath };
}
