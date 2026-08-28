import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Debug Add to Watch at Cursor composition", () => {
  it("validates the UI capture against the exact editor-session owner", () => {
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
      "utf8",
    );
    const editorNavigationCoordinator = readFileSync(
      new URL("./workbenchController/useWorkbenchEditorNavigationCoordinator.ts", import.meta.url),
      "utf8",
    );
    const controllerOptions = readFileSync(
      new URL("./workbenchDebugControllerOptions.ts", import.meta.url),
      "utf8",
    );
    const controllerContracts = readFileSync(
      new URL("./workbenchControllerContracts.ts", import.meta.url),
      "utf8",
    );
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const commandEffects = readFileSync(
      new URL("./workbenchController/useWorkbenchCommandEffectsCoordinator.ts", import.meta.url),
      "utf8",
    );
    const rootBindingEnd = editorNavigationCoordinator.indexOf(
      "} = useWorkbenchTaskDebugCoordinator({",
    );
    const rootBinding = editorNavigationCoordinator.slice(
      editorNavigationCoordinator.lastIndexOf("  const {", rootBindingEnd),
      rootBindingEnd,
    );
    const commandsStart = commandEffects.indexOf(
      "const commandRegistry = useWorkbenchCommandRegistry({",
    );
    const commands = commandEffects.slice(
      commandsStart,
      commandEffects.indexOf("\n  });", commandsStart),
    );

    expect(controllerOptions).toContain(
      "debugWatchAtCursorCaptureReader?: DebugWatchAtCursorCaptureReader | null;",
    );
    expect(controllerContracts).toContain(
      "export interface WorkbenchControllerOptions extends WorkbenchDebugControllerOptions {",
    );
    expect(controller).toContain("type WorkbenchTaskDebugOptions = Pick<");
    expect(controller).toContain("options: WorkbenchTaskDebugOptions;");
    expect(controller).toContain("captureReader: options.debugWatchAtCursorCaptureReader,");
    expect(controller).toContain("currentEditorSessionOwnerKeyRef.current === ownerKey");
    expect(controller).toContain("...cursorDebug,");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}debugWatchAtCursor,$/mu);
    expect(commands).toMatch(/^ {4}debugWatchAtCursor: taskDebug\.debugWatchAtCursor,$/mu);
  });
});
