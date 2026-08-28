import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Restart Frame composition", () => {
  it("routes only the narrow owner-fenced command port to commands and UI", () => {
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
      "utf8",
    );
    const editorNavigationCoordinator = readFileSync(
      new URL("./workbenchController/useWorkbenchEditorNavigationCoordinator.ts", import.meta.url),
      "utf8",
    );
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const start = controller.indexOf("const debugRestartFrame = useDebugRestartFrame({");
    const end = controller.indexOf("\n  });", start);
    const composition = controller.slice(start, end);
    const rootBindingEnd = editorNavigationCoordinator.indexOf(
      "} = useWorkbenchTaskDebugCoordinator({",
    );
    const rootBinding = editorNavigationCoordinator.slice(
      editorNavigationCoordinator.lastIndexOf("  const {", rootBindingEnd),
      rootBindingEnd,
    );
    const commandsStart = rootController.indexOf(
      "const commandRegistry = useWorkbenchCommandRegistry({",
    );
    const commands = rootController.slice(
      commandsStart,
      rootController.indexOf("\n  });", commandsStart),
    );
    const publicSurface = coordinatorPublicSurface(editorNavigationCoordinator);
    const projection = rootController.slice(rootController.indexOf("\n  return {", commandsStart));

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(composition).toContain("canRestartFrame: debug.debugSession.canRestartFrame,");
    expect(composition).toContain(
      "getDebugAdapterKind: () => debug.debugSession.debugAdapterKind,",
    );
    expect(composition).toContain("getPauseOwner: () => debug.debugSession.pauseOwner,");
    expect(composition).toContain("getSelectedFrameId: () => debug.debugSession.selectedFrameId,");
    expect(composition).toContain("getSnapshot: () => debug.debugSession.snapshot,");
    expect(composition).toContain("isWorkspaceTrusted,");
    expect(composition).toContain("restartFrame: debug.debugSession.restartFrame,");
    expect(controller).toContain("const debugRestartFrame = useDebugRestartFrame({");
    expect(controller.match(/debugRestartFrame,/g)).toHaveLength(1);
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("publicSurface: editorNavigationSurface,");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}debugRestartFrame,$/mu);
    expect(commands).toMatch(/^ {4}debugRestartFrame: taskDebug\.debugRestartFrame,$/mu);
    expect(publicSurface).toMatch(/^ {6}debugRestartFrame,$/mu);
    expect(projection).toMatch(/^ {4}\.\.\.editorNavigationSurface,$/mu);

    const panelComposition = readFileSync(
      new URL("../components/useAppTestDebugPanels.ts", import.meta.url),
      "utf8",
    );
    expect(panelComposition).toContain("debugRestartFrame: workbench.debugRestartFrame,");
  });
});

function coordinatorPublicSurface(source: string): string {
  const start = source.indexOf("publicSurface: {");
  return source.slice(start, source.indexOf("\n    statusBar:", start));
}
