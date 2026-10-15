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
  hasWorkspace: false,
};

describe("dispatchNativeMenuCommand", () => {
  it("dispatches every mapped native menu event through the command runner", () => {
    const expectedCommandIds = [
      "workbench.closeActive",
      "workbench.zoomIn",
      "workbench.zoomOut",
      "workbench.zoomReset",
      "workbench.openAppearanceSettings",
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
      "mockor-open-appearance-settings",
    ]);
    expect(results).toEqual(NATIVE_MENU_EVENT_NAMES.map(() => true));
    expect(runCommand.mock.calls).toEqual(
      expectedCommandIds.map((commandId) => [commandId, commandContext]),
    );
  });

  it.each([false, true])(
    "dispatches window zoom regardless of the workspace (%s)",
    (hasWorkspace) => {
      const context = { ...commandContext, hasWorkspace };
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
    expect(runCommand).toHaveBeenCalledWith("workbench.closeActive", commandContext);
  });

  it.each([
    "mockor-unknown-event",
    "mockor-editor-font-zoom-in",
    "mockor-editor-font-zoom-out",
    "mockor-editor-font-zoom-reset",
    "mockor-toggle-font-ligatures",
  ])("returns false for the unmapped event %s", (eventName) => {
    const runCommand = commandRunner("executed");

    const dispatched = dispatchNativeMenuCommand({
      commandContext,
      eventName,
      runCommand,
    });

    expect(dispatched).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns false when the mapped command is not registered", () => {
    const runCommand = commandRunner("missing");

    const dispatched = dispatchNativeMenuCommand({
      commandContext,
      eventName: "mockor-open-appearance-settings",
      runCommand,
    });

    expect(dispatched).toBe(false);
    expect(runCommand).toHaveBeenCalledWith("workbench.openAppearanceSettings", commandContext);
  });
});

function commandRunner(outcome: CommandExecutionOutcome) {
  return vi.fn<CommandExecutionRunner>(() => outcome);
}
