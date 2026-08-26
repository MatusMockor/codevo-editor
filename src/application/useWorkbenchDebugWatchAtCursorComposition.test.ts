import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Debug Add to Watch at Cursor composition", () => {
  it("validates the UI capture against the exact editor-session owner", () => {
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
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
    expect(rootBinding).toMatch(/^ {4}debugWatchAtCursor,$/mu);
    expect(commands).toMatch(/^ {4}debugWatchAtCursor,$/mu);
  });
});
