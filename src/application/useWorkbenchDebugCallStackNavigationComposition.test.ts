import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Call Stack navigation composition", () => {
  it("routes the owner-fenced navigation port into the command registry", () => {
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
      "utf8",
    );
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const start = controller.indexOf(
      "const debugCallStackNavigation = useDebugCallStackNavigation({",
    );
    const end = controller.indexOf("\n  });", start);
    const composition = controller.slice(start, end);
    const rootBindingEnd = rootController.indexOf("} = useWorkbenchTaskDebugCoordinator({");
    const rootBinding = rootController.slice(
      rootController.lastIndexOf("  const {", rootBindingEnd),
      rootBindingEnd,
    );
    const commandsStart = rootController.indexOf(
      "const commandRegistry = useWorkbenchCommandRegistry({",
    );
    const commands = rootController.slice(
      commandsStart,
      rootController.indexOf("\n  });", commandsStart),
    );

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(composition).toContain("getPauseOwner: () => debug.debugSession.pauseOwner,");
    expect(composition).toContain("getSelectedFrameId: () => debug.debugSession.selectedFrameId,");
    expect(composition).toContain("getSnapshot: () => debug.debugSession.snapshot,");
    expect(composition).toContain("selectFrame: debug.debugSession.selectFrame,");
    expect(controller).toContain("debugCallStackNavigation,");
    expect(rootBinding).toMatch(/^ {4}debugCallStackNavigation,$/mu);
    expect(commands).toMatch(/^ {4}debugCallStackNavigation,$/mu);
  });
});
