// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../domain/settings";
import type { DoubleShiftDetector } from "../domain/doubleShiftDetector";
import { CommandRegistry, type CommandContext } from "./commandRegistry";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const commandContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: true,
};

describe("useWorkbenchKeyboardShortcuts", () => {
  it.each([
    {
      commandId: "editor.splitRight",
      event: { key: "\\", metaKey: true },
      shortcut: "Cmd+\\",
    },
    {
      commandId: "editor.reopenClosedTab",
      event: { altKey: true, key: "t", metaKey: true, shiftKey: true },
      shortcut: "Cmd+Alt+Shift+T",
    },
    {
      commandId: "editor.splitDown",
      event: { altKey: true, key: "2", metaKey: true },
      shortcut: "Cmd+Alt+2",
    },
  ] as const)(
    "dispatches registered keymap command $commandId without an allowlist entry",
    ({ commandId, event: eventInit, shortcut }) => {
      const run = vi.fn();
      const registry = new CommandRegistry();
      registry.register({
        category: "Test",
        id: commandId,
        isEnabled: () => true,
        run,
        title: commandId,
      });
      const appSettings = defaultAppSettings();
      const harness = renderHook({
        appSettings: {
          ...appSettings,
          keymap: {
            ...appSettings.keymap,
            [commandId]: shortcut,
          },
        },
        commandRegistry: registry,
      });

      const event = dispatchKeyboardEvent(eventInit);

      expect(event.defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);

      harness.unmount();
    },
  );

  it("dispatches registry shortcuts through the command registry", () => {
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Workbench",
      id: "workbench.openSettings",
      isEnabled: () => true,
      run,
      title: "Settings",
    });
    const harness = renderHook({
      commandRegistry: registry,
    });

    const event = dispatchKeyboardEvent({ key: ",", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("consumes disabled editor save through the registry without manual fallback", () => {
    const actions = createActions();
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Editor",
      id: "editor.save",
      isEnabled: () => false,
      run,
      title: "Save File",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
    });

    const event = dispatchKeyboardEvent({ key: "s", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(actions.saveActiveDocument).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("routes file structure through registry enablement", () => {
    const actions = createActions();
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Editor",
      id: "editor.fileStructure",
      isEnabled: () => false,
      run,
      title: "File Structure",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
    });

    const event = dispatchKeyboardEvent({ key: "r", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(actions.openFileStructure).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("routes go to definition through registry enablement", () => {
    const actions = createActions();
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Editor",
      id: "editor.goToDefinition",
      isEnabled: () => true,
      run,
      title: "Go to Definition",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
    });

    const event = dispatchKeyboardEvent({ key: "b", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(actions.goToDefinition).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("routes implementation and references through registry enablement", () => {
    const actions = createActions();
    const implementation = vi.fn();
    const references = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Editor",
      id: "editor.goToImplementation",
      isEnabled: () => true,
      run: implementation,
      title: "Go to Implementation",
    });
    registry.register({
      category: "Editor",
      id: "editor.findReferences",
      isEnabled: () => true,
      run: references,
      title: "Find All References",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
    });

    const implementationEvent = dispatchKeyboardEvent({
      altKey: true,
      key: "b",
      metaKey: true,
    });
    const referencesEvent = dispatchKeyboardEvent({
      key: "F12",
      shiftKey: true,
    });

    expect(implementationEvent.defaultPrevented).toBe(true);
    expect(referencesEvent.defaultPrevented).toBe(true);
    expect(implementation).toHaveBeenCalledTimes(1);
    expect(references).toHaveBeenCalledTimes(1);
    expect(actions.goToImplementation).not.toHaveBeenCalled();
    expect(actions.openReferencesPanel).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("routes editor surface commands through registry enablement", () => {
    const actions = createActions();
    const quickFix = vi.fn();
    const rename = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Editor",
      id: "editor.quickFix",
      isEnabled: () => true,
      run: quickFix,
      title: "Context Actions",
    });
    registry.register({
      category: "Editor",
      id: "editor.rename",
      isEnabled: () => false,
      run: rename,
      title: "Rename Symbol",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
    });

    const quickFixEvent = dispatchKeyboardEvent({
      altKey: true,
      key: "Enter",
    });
    const renameEvent = dispatchKeyboardEvent({ key: "F2" });

    expect(quickFixEvent.defaultPrevented).toBe(true);
    expect(renameEvent.defaultPrevented).toBe(true);
    expect(quickFix).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("routes bookmark, git history, and PHP test shortcuts through registry enablement", () => {
    const actions = createActions();
    const registry = new CommandRegistry();
    const commands = [
      commandShortcutCase("bookmark.toggle", "Bookmarks", "Toggle Bookmark", {
        key: "F11",
      }),
      commandShortcutCase("editor.toggleGitBlame", "Editor", "Git Blame", {
        altKey: true,
        key: "g",
        metaKey: true,
      }),
      commandShortcutCase("editor.showFileHistory", "Editor", "File History", {
        altKey: true,
        key: "h",
        metaKey: true,
      }),
      commandShortcutCase("editor.showLocalHistory", "Editor", "Local History", {
        key: "h",
        metaKey: true,
        shiftKey: true,
      }),
      commandShortcutCase("php.goToTest", "PHP", "Go to Test", {
        key: "u",
        metaKey: true,
        shiftKey: true,
      }),
      commandShortcutCase("php.runTest", "PHP", "Run Test", {
        altKey: true,
        key: "t",
        metaKey: true,
        shiftKey: true,
      }),
      commandShortcutCase("php.runTestFile", "PHP", "Run Test File", {
        altKey: true,
        key: "y",
        metaKey: true,
        shiftKey: true,
      }),
    ];
    commands.forEach(({ category, id, run, title }) => {
      registry.register({
        category,
        id,
        isEnabled: () => true,
        run,
        title,
      });
    });
    const harness = renderHook({
      actions,
      appSettings: {
        ...defaultAppSettings(),
        keymap: {
          ...defaultAppSettings().keymap,
          "bookmark.toggle": "F11",
          "editor.showFileHistory": "Cmd+Alt+H",
          "editor.showLocalHistory": "Cmd+Shift+H",
          "editor.toggleGitBlame": "Cmd+Alt+G",
          "php.goToTest": "Cmd+Shift+U",
          "php.runTest": "Cmd+Shift+Alt+T",
          "php.runTestFile": "Cmd+Shift+Alt+Y",
        },
      },
      commandRegistry: registry,
    });

    commands.forEach(({ eventInit, run }) => {
      expect(dispatchKeyboardEvent(eventInit).defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
    });
    expect(actions.toggleBookmarkAtCursor).not.toHaveBeenCalled();
    expect(actions.toggleGitBlame).not.toHaveBeenCalled();
    expect(actions.openFileHistory).not.toHaveBeenCalled();
    expect(actions.openLocalHistory).not.toHaveBeenCalled();
    expect(actions.goToTestForActiveDocument).not.toHaveBeenCalled();
    expect(actions.runTestForActiveDocument).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("runs the quit command through the registry on Cmd+Q", () => {
    const actions = createActions();
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Application",
      id: "app.quit",
      isEnabled: () => true,
      run,
      title: "Quit Application",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
    });

    const event = dispatchKeyboardEvent({ key: "q", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(actions.quitApplication).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("routes qualifying double-Shift through an enabled registry command", () => {
    const actions = createActions();
    const run = vi.fn();
    const registry = new CommandRegistry();
    const doubleShiftDetector = createDoubleShiftDetectorStub(true);
    registry.register({
      category: "Workbench",
      id: "workbench.searchEverywhere",
      isEnabled: () => true,
      run,
      title: "Search Everywhere",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
      doubleShiftDetector,
    });

    const event = dispatchKeyboardEvent({ key: "Shift", shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(actions.openSearchEverywhere).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("consumes qualifying double-Shift when the registry command is disabled", () => {
    const actions = createActions();
    const run = vi.fn();
    const registry = new CommandRegistry();
    const doubleShiftDetector = createDoubleShiftDetectorStub(true);
    registry.register({
      category: "Workbench",
      id: "workbench.searchEverywhere",
      isEnabled: () => false,
      run,
      title: "Search Everywhere",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
      doubleShiftDetector,
    });

    const event = dispatchKeyboardEvent({ key: "Shift", shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(actions.openSearchEverywhere).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("consumes qualifying double-Shift when the registry command is missing", () => {
    const actions = createActions();
    const doubleShiftDetector = createDoubleShiftDetectorStub(true);
    const harness = renderHook({
      actions,
      doubleShiftDetector,
    });

    const event = dispatchKeyboardEvent({ key: "Shift", shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(actions.openSearchEverywhere).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("routes default F12 alias to go to definition through the registry", () => {
    const actions = createActions();
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Editor",
      id: "editor.goToDefinition",
      isEnabled: () => true,
      run,
      title: "Go to Definition",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
    });

    const event = dispatchKeyboardEvent({ key: "F12" });

    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(actions.goToDefinition).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("consumes default F12 alias without running a disabled go to definition command", () => {
    const actions = createActions();
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register({
      category: "Editor",
      id: "editor.goToDefinition",
      isEnabled: () => false,
      run,
      title: "Go to Definition",
    });
    const harness = renderHook({
      actions,
      commandRegistry: registry,
    });

    const event = dispatchKeyboardEvent({ key: "F12" });

    expect(event.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(actions.goToDefinition).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("handles Escape through the floating surface action", () => {
    const actions = createActions({
      closeFloatingSurface: vi.fn(() => true),
    });
    const harness = renderHook({ actions });

    const event = dispatchKeyboardEvent({ key: "Escape" });

    expect(event.defaultPrevented).toBe(true);
    expect(actions.closeFloatingSurface).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("skips bare keys that cannot match a configured shortcut", () => {
    const actions = createActions();
    const harness = renderHook({ actions });

    const event = dispatchKeyboardEvent({ key: "a" });

    expect(event.defaultPrevented).toBe(false);
    expect(actions.saveActiveDocument).not.toHaveBeenCalled();

    harness.unmount();
  });
});

interface RenderHookOptions {
  actions?: KeyboardShortcutTestActions;
  appSettings?: ReturnType<typeof defaultAppSettings>;
  commandRegistry?: CommandRegistry;
  doubleShiftDetector?: DoubleShiftDetector;
}

type KeyboardShortcutTestActions = ReturnType<typeof createActionsBase>;

function renderHook({
  actions = createActions(),
  appSettings = defaultAppSettings(),
  commandRegistry = new CommandRegistry(),
  doubleShiftDetector = createDoubleShiftDetectorStub(),
}: RenderHookOptions = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <HookHarness
        actions={actions}
        appSettings={appSettings}
        commandRegistry={commandRegistry}
        doubleShiftDetector={doubleShiftDetector}
      />,
    );
  });

  return {
    unmount() {
      act(() => root.unmount());
    },
  };
}

function HookHarness({
  actions,
  appSettings,
  commandRegistry,
  doubleShiftDetector,
}: {
  actions: KeyboardShortcutTestActions;
  appSettings: ReturnType<typeof defaultAppSettings>;
  commandRegistry: CommandRegistry;
  doubleShiftDetector: DoubleShiftDetector;
}) {
  useWorkbenchKeyboardShortcuts({
    actions,
    appSettingsRef: ref(appSettings),
    bareKeyShortcutsRef: ref({ keymap: null, keys: new Set<string>() }),
    commandContext,
    commandRegistry,
    doubleShiftDetectorRef: ref(doubleShiftDetector),
  });

  return null;
}

function createActions(
  overrides: Partial<KeyboardShortcutTestActions> = {},
) {
  return {
    ...createActionsBase(),
    ...overrides,
  };
}

function createActionsBase() {
  return {
    closeActiveSurface: vi.fn(),
    closeFloatingSurface: vi.fn(() => false),
    goToDeclaration: vi.fn(),
    goToDefinition: vi.fn(),
    goToImplementation: vi.fn(),
    goToSourceDefinition: vi.fn(),
    goToSuperMethod: vi.fn(),
    goToTestForActiveDocument: vi.fn(),
    goToTypeDefinition: vi.fn(),
    openFileHistory: vi.fn(),
    openFileReferencesPanel: vi.fn(),
    openFileStructure: vi.fn(),
    openLocalHistory: vi.fn(),
    openReferencesPanel: vi.fn(),
    openSearchEverywhere: vi.fn(),
    quitApplication: vi.fn(),
    runTestForActiveDocument: vi.fn(),
    saveActiveDocument: vi.fn(),
    toggleBookmarkAtCursor: vi.fn(),
    toggleGitBlame: vi.fn(),
  };
}

function commandShortcutCase(
  id: Parameters<CommandRegistry["register"]>[0]["id"],
  category: string,
  title: string,
  eventInit: KeyboardEventInit & { key: string },
) {
  return {
    category,
    eventInit,
    id,
    run: vi.fn(),
    title,
  };
}

function createDoubleShiftDetectorStub(
  handleKeyDownResult = false,
): DoubleShiftDetector {
  return {
    handleKeyDown: vi.fn(() => handleKeyDownResult),
    reset: vi.fn(),
  };
}

function dispatchKeyboardEvent(init: KeyboardEventInit & { key: string }) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  window.dispatchEvent(event);
  return event;
}

function ref<T>(current: T) {
  return { current };
}
