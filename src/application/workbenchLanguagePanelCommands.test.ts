import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type {
  LanguageServerRuntimeCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { Command, CommandContext } from "./commandRegistry";
import { workbenchLanguagePanelCommands } from "./workbenchLanguagePanelCommands";

describe("workbenchLanguagePanelCommands", () => {
  it("returns language panel commands in registry order with metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = workbenchLanguagePanelCommands({
      ...baseOptions(),
      shortcut,
    });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "editor.fileStructure",
        title: "File Structure",
        category: "Editor",
        shortcut: "shortcut:editor.fileStructure",
      },
      {
        id: "editor.showCallHierarchy",
        title: "Show Call Hierarchy",
        category: "Editor",
        shortcut: undefined,
      },
      {
        id: "editor.showTypeHierarchy",
        title: "Show Type Hierarchy",
        category: "Editor",
        shortcut: undefined,
      },
      {
        id: "editor.findReferences",
        title: "Find All References",
        category: "Editor",
        shortcut: "shortcut:editor.findReferences",
      },
      {
        id: "editor.findFileReferences",
        title: "Find File References",
        category: "Editor",
        shortcut: "shortcut:editor.findFileReferences",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "editor.fileStructure");
    expect(shortcut).toHaveBeenNthCalledWith(2, "editor.findReferences");
    expect(shortcut).toHaveBeenNthCalledWith(3, "editor.findFileReferences");
    expect(shortcut).toHaveBeenCalledTimes(3);
  });

  it("keeps PHP file structure available for language-server documents", () => {
    expect(
      command(
        "editor.fileStructure",
        commandsFor({ activeDocument: phpDocument }),
      ).isEnabled(context),
    ).toBe(true);
    expect(
      command(
        "editor.fileStructure",
        commandsFor({ activeDocument: plainDocument }),
      ).isEnabled(context),
    ).toBe(false);
  });

  it("requires a matching JS/TS runtime with document symbols for JS/TS file structure", () => {
    expect(
      command(
        "editor.fileStructure",
        commandsFor({
          activeDocument: jsTsDocument,
          javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus({
            rootPath: "/workspace",
            documentSymbol: true,
          }),
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot: "/workspace",
          workspaceRoot: "/workspace",
        }),
      ).isEnabled(context),
    ).toBe(true);
    expect(
      command(
        "editor.fileStructure",
        commandsFor({
          activeDocument: jsTsDocument,
          javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus({
            rootPath: "/other",
            documentSymbol: true,
          }),
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot: "/other",
          workspaceRoot: "/workspace",
        }),
      ).isEnabled(context),
    ).toBe(false);
  });

  it("enables hierarchy and references only when the active document runtime supports the feature", () => {
    const commands = commandsFor({
      activeDocument: phpDocument,
      languageServerRuntimeStatus: runningStatus({
        rootPath: "/workspace",
        callHierarchy: true,
        references: true,
        typeHierarchy: false,
      }),
      languageServerRuntimeStatusRoot: "/workspace",
      workspaceRoot: "/workspace",
    });

    expect(command("editor.showCallHierarchy", commands).isEnabled(context))
      .toBe(true);
    expect(command("editor.findReferences", commands).isEnabled(context)).toBe(
      true,
    );
    expect(command("editor.showTypeHierarchy", commands).isEnabled(context))
      .toBe(false);
  });

  it("enables file references only for JS/TS documents with a matching running runtime", () => {
    expect(
      command(
        "editor.findFileReferences",
        commandsFor({
          activeDocument: jsTsDocument,
          javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus({
            rootPath: "/workspace",
          }),
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot: "/workspace",
          workspaceRoot: "/workspace",
        }),
      ).isEnabled(context),
    ).toBe(true);
    expect(
      command(
        "editor.findFileReferences",
        commandsFor({
          activeDocument: phpDocument,
          javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus({
            rootPath: "/workspace",
          }),
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot: "/workspace",
          workspaceRoot: "/workspace",
        }),
      ).isEnabled(context),
    ).toBe(false);
  });

  it("invokes the exact injected callbacks and returns their values directly", () => {
    const results = Array.from({ length: 5 }, () => Promise.resolve());
    const callbacks = results.map((result) => vi.fn(() => result));
    const commands = workbenchLanguagePanelCommands({
      ...baseOptions(),
      openFileStructure: callbacks[0],
      openCallHierarchy: callbacks[1],
      openTypeHierarchy: callbacks[2],
      openReferencesPanel: callbacks[3],
      openFileReferencesPanel: callbacks[4],
    });

    commands.forEach((command, index) => {
      expect(command.run()).toBe(results[index]);
      expect(callbacks[index]).toHaveBeenCalledTimes(1);
    });
  });
});

type Options = Parameters<typeof workbenchLanguagePanelCommands>[0];

function commandsFor(overrides: Partial<Options> = {}): Command[] {
  return workbenchLanguagePanelCommands({
    ...baseOptions(),
    ...overrides,
  });
}

function baseOptions(): Options {
  return {
    shortcut: (commandId) => commandId,
    activeDocument: null,
    languageServerRuntimeStatus: null,
    languageServerRuntimeStatusRoot: null,
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    workspaceRoot: null,
    openFileStructure: vi.fn(),
    openCallHierarchy: vi.fn(),
    openTypeHierarchy: vi.fn(),
    openReferencesPanel: vi.fn(),
    openFileReferencesPanel: vi.fn(),
  };
}

function command(id: string, commands: Command[]): Command {
  const match = commands.find((command) => command.id === id);

  if (!match) {
    throw new Error(`Missing command: ${id}`);
  }

  return match;
}

function runningStatus({
  rootPath,
  ...capabilities
}: Partial<LanguageServerRuntimeCapabilities> & {
  rootPath: string;
}): LanguageServerRuntimeStatus {
  return {
    kind: "running",
    rootPath,
    sessionId: 1,
    capabilities: {
      ...allCapabilities(false),
      ...capabilities,
    },
  };
}

function allCapabilities(enabled: boolean): LanguageServerRuntimeCapabilities {
  return {
    callHierarchy: enabled,
    codeAction: enabled,
    codeActionResolve: enabled,
    codeLens: enabled,
    completion: enabled,
    declaration: enabled,
    definition: enabled,
    didCreateFiles: enabled,
    didDeleteFiles: enabled,
    didRenameFiles: enabled,
    documentHighlight: enabled,
    documentLink: enabled,
    documentSymbol: enabled,
    foldingRange: enabled,
    formatting: enabled,
    hover: enabled,
    implementation: enabled,
    inlayHint: enabled,
    linkedEditingRange: enabled,
    onTypeFormatting: enabled,
    prepareRename: enabled,
    rangeFormatting: enabled,
    references: enabled,
    rename: enabled,
    selectionRange: enabled,
    semanticTokens: enabled,
    signatureHelp: enabled,
    sourceDefinition: enabled,
    typeDefinition: enabled,
    typeHierarchy: enabled,
    willCreateFiles: enabled,
    willDeleteFiles: enabled,
    willRenameFiles: enabled,
    workspaceSymbol: enabled,
  };
}

const context: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: true,
  hasWorkspace: true,
};

const phpDocument = {
  isJavaScriptTypeScriptLanguageServerDocument: false,
  isLanguageServerDocument: true,
  language: "php",
};

const jsTsDocument = {
  isJavaScriptTypeScriptLanguageServerDocument: true,
  isLanguageServerDocument: true,
  language: "typescript",
};

const plainDocument = {
  isJavaScriptTypeScriptLanguageServerDocument: false,
  isLanguageServerDocument: false,
  language: "text",
};
