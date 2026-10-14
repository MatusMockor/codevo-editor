import { describe, expect, it, vi } from "vitest";
import type {
  CommandContext,
  CommandExecutionOutcome,
  CommandExecutionRunner,
} from "./commandRegistry";
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
  it("dispatches every mapped native menu event through the command runner", () => {
    const expectedCommandIds = [
      "editor.closeTab",
      "workbench.zoomIn",
      "workbench.zoomOut",
      "workbench.zoomReset",
      "editor.fontZoomIn",
      "editor.fontZoomOut",
      "editor.fontZoomReset",
      "workbench.openAppearanceSettings",
      "editor.toggleFontLigatures",
    ];
    const runCommand = commandRunner("executed");

    const results = NATIVE_MENU_EVENT_NAMES.map((eventName) =>
      dispatchNativeMenuCommand({
        commandContext,
        eventName,
        runCommand,
      }),
    );

    expect(NATIVE_MENU_EVENT_NAMES).toEqual([
      "mockor-close-active-tab",
      "mockor-window-zoom-in",
      "mockor-window-zoom-out",
      "mockor-window-zoom-reset",
      "mockor-editor-font-zoom-in",
      "mockor-editor-font-zoom-out",
      "mockor-editor-font-zoom-reset",
      "mockor-open-appearance-settings",
      "mockor-toggle-font-ligatures",
    ]);
    expect(results).toEqual(NATIVE_MENU_EVENT_NAMES.map(() => true));
    expect(runCommand.mock.calls).toEqual(
      expectedCommandIds.map((commandId) => [commandId, commandContext]),
    );
  });

  it.each([false, true])(
    "dispatches window zoom without depending on an active editor (%s)",
    (hasActiveDocument) => {
      const context = { ...commandContext, hasActiveDocument };
      const runCommand = commandRunner("executed");

      for (const eventName of [
        "mockor-window-zoom-in",
        "mockor-window-zoom-out",
        "mockor-window-zoom-reset",
      ]) {
        expect(
          dispatchNativeMenuCommand({
            commandContext: context,
            eventName,
            runCommand,
          }),
        ).toBe(true);
      }

      expect(runCommand.mock.calls).toEqual([
        ["workbench.zoomIn", context],
        ["workbench.zoomOut", context],
        ["workbench.zoomReset", context],
      ]);
    },
  );

  it("consumes a disabled command", () => {
    const runCommand = commandRunner("disabled");

    const dispatched = dispatchNativeMenuCommand({
      commandContext,
      eventName: "mockor-close-active-tab",
      runCommand,
    });

    expect(dispatched).toBe(true);
    expect(runCommand).toHaveBeenCalledWith("editor.closeTab", commandContext);
  });

  it("returns false for an unknown event name", () => {
    const runCommand = commandRunner("executed");

    const dispatched = dispatchNativeMenuCommand({
      commandContext,
      eventName: "mockor-unknown-event",
      runCommand,
    });

    expect(dispatched).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns false when the mapped command is not registered", () => {
    const runCommand = commandRunner("missing");

    const dispatched = dispatchNativeMenuCommand({
      commandContext,
      eventName: "mockor-editor-font-zoom-in",
      runCommand,
    });

    expect(dispatched).toBe(false);
    expect(runCommand).toHaveBeenCalledWith("editor.fontZoomIn", commandContext);
  });
});

function commandRunner(outcome: CommandExecutionOutcome) {
  return vi.fn<CommandExecutionRunner>(() => outcome);
}
