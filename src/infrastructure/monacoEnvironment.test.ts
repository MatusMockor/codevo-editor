// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from "vitest";

const configuredMonaco = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@monaco-editor/react", () => ({
  loader: {
    config: ({ monaco }: { readonly monaco: unknown }) => {
      configuredMonaco.current = monaco;
    },
  },
}));

describe("configureMonacoEnvironment", () => {
  beforeAll(() => {
    if (typeof document.queryCommandSupported === "function") return;
    Object.defineProperty(document, "queryCommandSupported", {
      configurable: true,
      value: () => false,
    });
  });

  it("hands the loader a Monaco runtime with the editor contributions the workbench drives", async () => {
    const { configureMonacoEnvironment } = await import("./monacoEnvironment");
    const { EditorExtensionsRegistry } =
      await import("monaco-editor/esm/vs/editor/browser/editorExtensions.js");
    const { CommandsRegistry } =
      await import("monaco-editor/esm/vs/platform/commands/common/commands.js");

    configureMonacoEnvironment({});

    expect(configuredMonaco.current).not.toBeNull();
    const contributions = EditorExtensionsRegistry.getEditorContributions().map(({ id }) => id);
    expect(contributions).toEqual(
      expect.arrayContaining([
        "editor.contrib.contextmenu",
        "editor.contrib.findController",
        "editor.contrib.referencesController",
        "editor.contrib.renameController",
        "editor.contrib.suggestController",
      ]),
    );
    const actions = EditorExtensionsRegistry.getEditorActions().map(({ id }) => id);
    expect(actions).toEqual(expect.arrayContaining(["actions.find", "editor.action.rename"]));
    for (const commandId of [
      "editor.action.revealDefinition",
      "editor.action.referenceSearch.trigger",
    ]) {
      expect(CommandsRegistry.getCommand(commandId)).toBeDefined();
    }
  }, 30_000);

  it("registers the suggest commands the QA and perf bridges trigger on the active editor", async () => {
    const { configureMonacoEnvironment } = await import("./monacoEnvironment");
    const { EditorExtensionsRegistry } =
      await import("monaco-editor/esm/vs/editor/browser/editorExtensions.js");
    const { CommandsRegistry } =
      await import("monaco-editor/esm/vs/platform/commands/common/commands.js");

    configureMonacoEnvironment({});

    const actions = EditorExtensionsRegistry.getEditorActions().map(({ id }) => id);
    expect(actions).toContain("editor.action.triggerSuggest");
    expect(CommandsRegistry.getCommand("hideSuggestWidget")).toBeDefined();
  }, 30_000);

  it("hides Monaco's command-layer bypasses from the editor context menu and unbinds F1", async () => {
    const { configureMonacoEnvironment } = await import("./monacoEnvironment");
    const { MenuId, MenuRegistry } =
      await import("monaco-editor/esm/vs/platform/actions/common/actions.js");
    const { KeybindingsRegistry } =
      await import("monaco-editor/esm/vs/platform/keybinding/common/keybindingsRegistry.js");

    configureMonacoEnvironment({});

    const hiddenMenuCommands = MenuRegistry.getMenuItems(MenuId.EditorContext)
      .filter((item) => item.when?.serialize() === "false")
      .map((item) => item.command?.id)
      .sort();
    expect(hiddenMenuCommands).toEqual([
      "editor.action.formatDocument",
      "editor.action.goToImplementation",
      "editor.action.goToReferences",
      "editor.action.goToTypeDefinition",
      "editor.action.quickCommand",
      "editor.action.quickOutline",
      "editor.action.refactor",
      "editor.action.rename",
      "editor.action.revealDeclaration",
      "editor.action.revealDefinition",
      "editor.action.sourceAction",
    ]);
    const quickCommandBindings = KeybindingsRegistry.getDefaultKeybindings().filter(
      (item) => item.command === "editor.action.quickCommand",
    );
    expect(quickCommandBindings.length).toBeGreaterThan(0);
    expect(quickCommandBindings.every((item) => item.when?.serialize() === "false")).toBe(true);
  }, 30_000);
});
