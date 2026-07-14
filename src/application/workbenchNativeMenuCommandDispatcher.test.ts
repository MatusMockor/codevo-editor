import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, type CommandContext } from "./commandRegistry";
import {
  NATIVE_MENU_EVENT_NAMES,
  dispatchNativeMenuCommand,
} from "./workbenchNativeMenuCommandDispatcher";

const commandContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

describe("dispatchNativeMenuCommand", () => {
  it("dispatches every mapped native menu event to its registry command", () => {
    const expectedCommandIds = [
      "editor.closeTab",
      "editor.fontZoomIn",
      "editor.fontZoomOut",
      "editor.fontZoomReset",
      "editor.toggleFontLigatures",
      "workbench.openAppearanceSettings",
    ];
    const runs = new Map(expectedCommandIds.map((id) => [id, vi.fn()]));
    const commandRegistry = new CommandRegistry();
    runs.forEach((run, id) => {
      commandRegistry.register({
        category: "Test",
        id,
        isEnabled: () => true,
        run,
        title: id,
      });
    });

    const results = NATIVE_MENU_EVENT_NAMES.map((eventName) =>
      dispatchNativeMenuCommand({
        commandContext,
        commandRegistry,
        eventName,
      }),
    );

    expect(NATIVE_MENU_EVENT_NAMES).toEqual([
      "mockor-close-active-tab",
      "mockor-editor-font-zoom-in",
      "mockor-editor-font-zoom-out",
      "mockor-editor-font-zoom-reset",
      "mockor-open-appearance-settings",
      "mockor-toggle-font-ligatures",
    ]);
    expect(results).toEqual(NATIVE_MENU_EVENT_NAMES.map(() => true));
    runs.forEach((run) => expect(run).toHaveBeenCalledTimes(1));
  });

  it("skips a disabled command without running it", () => {
    const run = vi.fn();
    const commandRegistry = new CommandRegistry();
    commandRegistry.register({
      category: "Editor",
      id: "editor.closeTab",
      isEnabled: () => false,
      run,
      title: "Close",
    });

    const dispatched = dispatchNativeMenuCommand({
      commandContext,
      commandRegistry,
      eventName: "mockor-close-active-tab",
    });

    expect(dispatched).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns false for an unknown event name", () => {
    const run = vi.fn();
    const commandRegistry = new CommandRegistry();
    commandRegistry.register({
      category: "Editor",
      id: "editor.closeTab",
      isEnabled: () => true,
      run,
      title: "Close",
    });

    const dispatched = dispatchNativeMenuCommand({
      commandContext,
      commandRegistry,
      eventName: "mockor-unknown-event",
    });

    expect(dispatched).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns false when the mapped command is not registered", () => {
    const dispatched = dispatchNativeMenuCommand({
      commandContext,
      commandRegistry: new CommandRegistry(),
      eventName: "mockor-editor-font-zoom-in",
    });

    expect(dispatched).toBe(false);
  });
});
