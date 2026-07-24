import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Debug Add to Watch at Cursor composition", () => {
  it("validates the UI capture against the exact editor-session owner", () => {
    const controller = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
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

    expect(controllerOptions).toContain(
      "debugWatchAtCursorCaptureReader?: DebugWatchAtCursorCaptureReader | null;",
    );
    expect(controllerContracts).toContain(
      "export interface WorkbenchControllerOptions extends WorkbenchDebugControllerOptions {",
    );
    expect(controller).toContain("options: WorkbenchControllerOptions = {},");
    expect(controller).toContain("captureReader: options.debugWatchAtCursorCaptureReader,");
    expect(controller).toContain("currentEditorSessionOwnerKeyRef.current === ownerKey");
    expect(controller).toContain("debugWatchAtCursor,");
  });
});
