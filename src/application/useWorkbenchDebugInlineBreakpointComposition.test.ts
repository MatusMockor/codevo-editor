import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench inline breakpoint composition", () => {
  it("composes the focused editor capture with private session ownership", () => {
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
    const start = controller.indexOf("const debugInlineBreakpoint = useDebugInlineBreakpoint({");
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
    const projection = rootController.slice(rootController.indexOf("\n  return {", commandsStart));

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(controllerOptions).toContain(
      "debugInlineBreakpointCaptureReader?: DebugInlineBreakpointCaptureReader | null;",
    );
    expect(controllerContracts).toContain(
      "export interface WorkbenchControllerOptions extends WorkbenchDebugControllerOptions {",
    );
    expect(controller).toContain("type WorkbenchTaskDebugOptions = Pick<");
    expect(controller).toContain("options: WorkbenchTaskDebugOptions;");
    expect(composition).toContain("addBreakpoint: debug.debugSession.addInlineBreakpoint,");
    expect(composition).toContain("captureReader: options.debugInlineBreakpointCaptureReader,");
    expect(composition).toContain("getBreakpoints: () => debug.debugSession.breakpoints,");
    expect(composition).toContain("isWorkspaceCurrent: isCurrentJavaScriptEditorWorkspaceOwner,");
    expect(composition).not.toContain("debugGateway");
    expect(composition).not.toContain("isWorkspaceTrusted");
    expect(controller).toContain("debugInlineBreakpoint,");
    expect(rootBinding).toMatch(/^ {4}debugInlineBreakpoint,$/mu);
    expect(commands).toMatch(/^ {4}debugInlineBreakpoint,$/mu);
    expect(projection).toMatch(/^ {4}debugInlineBreakpoint,$/mu);
  });

  it("routes only the active scoped editor reader into the controller", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const scoped = readFileSync(
      new URL("../components/ScopedEditorSurface.tsx", import.meta.url),
      "utf8",
    );

    expect(app).toContain(
      "updateDebugInlineBreakpointCapture: updateDebugInlineBreakpointCaptureReader,",
    );
    expect(app).toContain("debugInlineBreakpointCapture: debugInlineBreakpointCaptureReader,");
    expect(app).toContain("debugInlineBreakpointCaptureReader,");
    expect(app).toContain("onDebugInlineBreakpointCaptureReaderChange={");
    expect(app).toContain("updateDebugInlineBreakpointCaptureReader");
    expect(scoped).toContain("onDebugInlineBreakpointCaptureReaderChange(groupId, reader)");
  });
});
