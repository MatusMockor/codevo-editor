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
  commandRegistry?: CommandRegistry;
}

type KeyboardShortcutTestActions = ReturnType<typeof createActionsBase>;

function renderHook({
  actions = createActions(),
  commandRegistry = new CommandRegistry(),
}: RenderHookOptions = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <HookHarness actions={actions} commandRegistry={commandRegistry} />,
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
  commandRegistry,
}: {
  actions: KeyboardShortcutTestActions;
  commandRegistry: CommandRegistry;
}) {
  useWorkbenchKeyboardShortcuts({
    actions,
    appSettingsRef: ref(defaultAppSettings()),
    bareKeyShortcutsRef: ref({ keymap: null, keys: new Set<string>() }),
    commandContext,
    commandRegistry,
    doubleShiftDetectorRef: ref(createDoubleShiftDetectorStub()),
    workspaceRoot: "/workspace",
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

function createDoubleShiftDetectorStub(): DoubleShiftDetector {
  return {
    handleKeyDown: vi.fn(() => false),
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
