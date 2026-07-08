import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type {
  LanguageServerRuntimeCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { Command, CommandContext } from "./commandRegistry";
import { workbenchLanguageNavigationCommands } from "./workbenchLanguageNavigationCommands";

describe("workbenchLanguageNavigationCommands", () => {
  it("returns language navigation commands in registry order with metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = workbenchLanguageNavigationCommands({
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
        id: "editor.goToDefinition",
        title: "Go to Definition",
        category: "Editor",
        shortcut: "shortcut:editor.goToDefinition",
      },
      {
        id: "editor.goToSourceDefinition",
        title: "Go to Source Definition",
        category: "Editor",
        shortcut: "shortcut:editor.goToSourceDefinition",
      },
      {
        id: "editor.goToDeclaration",
        title: "Go to Declaration",
        category: "Editor",
        shortcut: "shortcut:editor.goToDeclaration",
      },
      {
        id: "editor.goToTypeDefinition",
        title: "Go to Type Definition",
        category: "Editor",
        shortcut: "shortcut:editor.goToTypeDefinition",
      },
      {
        id: "editor.goToImplementation",
        title: "Go to Implementation",
        category: "Editor",
        shortcut: "shortcut:editor.goToImplementation",
      },
      {
        id: "editor.goToSuperMethod",
        title: "Go to Super Method",
        category: "Editor",
        shortcut: "shortcut:editor.goToSuperMethod",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "editor.goToDefinition");
    expect(shortcut).toHaveBeenNthCalledWith(2, "editor.goToSourceDefinition");
    expect(shortcut).toHaveBeenNthCalledWith(3, "editor.goToDeclaration");
    expect(shortcut).toHaveBeenNthCalledWith(4, "editor.goToTypeDefinition");
    expect(shortcut).toHaveBeenNthCalledWith(5, "editor.goToImplementation");
    expect(shortcut).toHaveBeenNthCalledWith(6, "editor.goToSuperMethod");
    expect(shortcut).toHaveBeenCalledTimes(6);
  });

  it("enables go to definition for any active document", () => {
    expect(command("editor.goToDefinition", commandsFor()).isEnabled(context))
      .toBe(false);
    expect(
      command(
        "editor.goToDefinition",
        commandsFor({ activeDocument: phpDocument }),
      ).isEnabled(context),
    ).toBe(true);
    expect(
      command(
        "editor.goToDefinition",
        commandsFor({ activeDocument: plainDocument }),
      ).isEnabled(context),
    ).toBe(true);
  });

  it("enables JavaScript and TypeScript language-server navigation only for a matching running runtime with capability", () => {
    const jsDocumentCommands = commandsFor({
      activeDocument: jsTsDocument,
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus({
        rootPath: "/workspace",
        implementation: true,
      }),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: "/workspace",
      workspaceRoot: "/workspace",
    });

    expect(command("editor.goToImplementation", jsDocumentCommands).isEnabled(context))
      .toBe(true);

    const wrongRootCommands = commandsFor({
      activeDocument: jsTsDocument,
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus({
        rootPath: "/other",
        implementation: true,
      }),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: "/other",
      workspaceRoot: "/workspace",
    });

    expect(command("editor.goToImplementation", wrongRootCommands).isEnabled(context))
      .toBe(false);

    const missingCapabilityCommands = commandsFor({
      activeDocument: jsTsDocument,
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus({
        rootPath: "/workspace",
        implementation: false,
      }),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: "/workspace",
      workspaceRoot: "/workspace",
    });

    expect(
      command("editor.goToImplementation", missingCapabilityCommands).isEnabled(
        context,
      ),
    ).toBe(false);
  });

  it("enables PHP language-server navigation only for a matching running runtime with capability", () => {
    const phpCommands = commandsFor({
      activeDocument: phpDocument,
      languageServerRuntimeStatus: runningStatus({
        rootPath: "/workspace",
        declaration: true,
        typeDefinition: true,
      }),
      languageServerRuntimeStatusRoot: "/workspace",
      workspaceRoot: "/workspace",
    });

    expect(command("editor.goToDeclaration", phpCommands).isEnabled(context))
      .toBe(true);
    expect(command("editor.goToTypeDefinition", phpCommands).isEnabled(context))
      .toBe(true);

    const plainCommands = commandsFor({
      activeDocument: plainDocument,
      languageServerRuntimeStatus: runningStatus({
        rootPath: "/workspace",
        declaration: true,
      }),
      languageServerRuntimeStatusRoot: "/workspace",
      workspaceRoot: "/workspace",
    });

    expect(command("editor.goToDeclaration", plainCommands).isEnabled(context))
      .toBe(false);
  });

  it("limits source definition to JavaScript and TypeScript documents", () => {
    const runtime = runningStatus({
      rootPath: "/workspace",
      sourceDefinition: true,
    });

    expect(
      command(
        "editor.goToSourceDefinition",
        commandsFor({
          activeDocument: jsTsDocument,
          javaScriptTypeScriptLanguageServerRuntimeStatus: runtime,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot: "/workspace",
          workspaceRoot: "/workspace",
        }),
      ).isEnabled(context),
    ).toBe(true);
    expect(
      command(
        "editor.goToSourceDefinition",
        commandsFor({
          activeDocument: phpDocument,
          languageServerRuntimeStatus: runtime,
          languageServerRuntimeStatusRoot: "/workspace",
          workspaceRoot: "/workspace",
        }),
      ).isEnabled(context),
    ).toBe(false);
  });

  it("enables go to super method only for PHP documents", () => {
    expect(
      command(
        "editor.goToSuperMethod",
        commandsFor({ activeDocument: phpDocument }),
      ).isEnabled(context),
    ).toBe(true);
    expect(
      command(
        "editor.goToSuperMethod",
        commandsFor({ activeDocument: jsTsDocument }),
      ).isEnabled(context),
    ).toBe(false);
  });

  it("invokes the exact injected callbacks without returning navigation internals", () => {
    const results = Array.from({ length: 6 }, () => Promise.resolve());
    const callbacks = results.map((result) => vi.fn(() => result));
    const commands = workbenchLanguageNavigationCommands({
      ...baseOptions(),
      goToDefinition: callbacks[0],
      goToSourceDefinition: callbacks[1],
      goToDeclaration: callbacks[2],
      goToTypeDefinition: callbacks[3],
      goToImplementation: callbacks[4],
      goToSuperMethod: callbacks[5],
    });

    commands.forEach((command, index) => {
      expect(command.run()).toBeUndefined();
      expect(callbacks[index]).toHaveBeenCalledTimes(1);
    });
  });
});

type Options = Parameters<typeof workbenchLanguageNavigationCommands>[0];

function commandsFor(overrides: Partial<Options> = {}): Command[] {
  return workbenchLanguageNavigationCommands({
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
    goToDefinition: vi.fn(),
    goToSourceDefinition: vi.fn(),
    goToDeclaration: vi.fn(),
    goToTypeDefinition: vi.fn(),
    goToImplementation: vi.fn(),
    goToSuperMethod: vi.fn(),
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
