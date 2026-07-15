import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import {
  CommandRegistry,
  executeCommand,
  type Command,
  type CommandContext,
} from "./commandRegistry";
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
    expect(
      command("editor.goToDefinition", commandsFor()).isEnabled({
        ...context,
        hasActiveDocument: false,
      }),
    ).toBe(false);
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

  it("uses the registry execution context when the captured document is null", () => {
    const registry = new CommandRegistry();
    const goToDefinition = vi.fn();

    commandsFor({ activeDocument: null, goToDefinition }).forEach((command) =>
      registry.register(command),
    );

    expect(
      executeCommand(registry, "editor.goToDefinition", {
        ...context,
        hasActiveDocument: true,
      }),
    ).toBe("executed");
    expect(goToDefinition).toHaveBeenCalledOnce();
  });

  it("keeps JavaScript and TypeScript navigation enabled so runtime fallbacks can decide", () => {
    const jsDocumentCommands = commandsFor({ activeDocument: jsTsDocument });

    expect(command("editor.goToImplementation", jsDocumentCommands).isEnabled(context))
      .toBe(true);
  });

  it("keeps PHP navigation enabled so indexed and framework fallbacks can decide", () => {
    const phpCommands = commandsFor({ activeDocument: phpDocument });

    expect(command("editor.goToDeclaration", phpCommands).isEnabled(context))
      .toBe(true);
    expect(command("editor.goToTypeDefinition", phpCommands).isEnabled(context))
      .toBe(true);

    const plainCommands = commandsFor({ activeDocument: plainDocument });

    expect(command("editor.goToDeclaration", plainCommands).isEnabled(context))
      .toBe(true);
  });

  it("keeps source definition enabled for any active document", () => {
    expect(
      command(
        "editor.goToSourceDefinition",
        commandsFor({ activeDocument: jsTsDocument }),
      ).isEnabled(context),
    ).toBe(true);
    expect(
      command(
        "editor.goToSourceDefinition",
        commandsFor({ activeDocument: phpDocument }),
      ).isEnabled(context),
    ).toBe(true);
  });

  it("keeps go to super method enabled for any active document", () => {
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
    ).toBe(true);
  });

  it("keeps each command pending until its injected navigation completes", async () => {
    const resolvers: Array<() => void> = [];
    const callbacks = Array.from({ length: 6 }, () =>
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolvers.push(() => resolve(true));
          }),
      ),
    );
    const commands = workbenchLanguageNavigationCommands({
      ...baseOptions(),
      goToDefinition: callbacks[0],
      goToSourceDefinition: callbacks[1],
      goToDeclaration: callbacks[2],
      goToTypeDefinition: callbacks[3],
      goToImplementation: callbacks[4],
      goToSuperMethod: callbacks[5],
    });

    const executions = commands.map((command, index) => {
      const execution = command.run();
      let settled = false;
      void execution?.then(() => {
        settled = true;
      });

      expect(callbacks[index]).toHaveBeenCalledTimes(1);
      return { execution, isSettled: () => settled };
    });

    await Promise.resolve();
    executions.forEach(({ isSettled }) => expect(isSettled()).toBe(false));

    resolvers.forEach((resolve) => resolve());
    await Promise.all(executions.map(({ execution }) => execution));
  });

  it("resolves each command to void instead of exposing navigation results", async () => {
    const callbacks = Array.from({ length: 6 }, (_, index) =>
      vi.fn(() => (index % 2 === 0 ? true : Promise.resolve(false))),
    );
    const commands = workbenchLanguageNavigationCommands({
      ...baseOptions(),
      goToDefinition: callbacks[0],
      goToSourceDefinition: callbacks[1],
      goToDeclaration: callbacks[2],
      goToTypeDefinition: callbacks[3],
      goToImplementation: callbacks[4],
      goToSuperMethod: callbacks[5],
    });

    await Promise.all(
      commands.map(async (command, index) => {
        await expect(command.run()).resolves.toBeUndefined();
        expect(callbacks[index]).toHaveBeenCalledTimes(1);
      }),
    );
  });

  it.each([
    ["synchronous", () => {
      throw new Error("navigation failed");
    }],
    ["asynchronous", () => Promise.reject(new Error("navigation failed"))],
  ])("propagates %s rejection and invokes navigation exactly once", async (_, fail) => {
    const goToDefinition = vi.fn(fail);
    const definition = command(
      "editor.goToDefinition",
      commandsFor({ goToDefinition }),
    );

    await expect(definition.run()).rejects.toThrow("navigation failed");
    expect(goToDefinition).toHaveBeenCalledTimes(1);
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
