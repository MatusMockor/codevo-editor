import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench breakpoint navigation composition", () => {
  it("composes the active editor capture with the private breakpoint model and owner-safe opener", () => {
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
    const start = controller.indexOf(
      "const debugBreakpointNavigation = useDebugBreakpointNavigation({",
    );
    const end = controller.indexOf("\n  });", start);
    const composition = controller.slice(start, end);
    const ownerPredicateStart = controller.indexOf("const isCurrentEditorWorkspaceOwner =");
    const ownerPredicateEnd = controller.indexOf(
      "\n  const debugEvaluateInConsole =",
      ownerPredicateStart,
    );
    const ownerPredicates = controller.slice(ownerPredicateStart, ownerPredicateEnd);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(ownerPredicateStart).toBeGreaterThanOrEqual(0);
    expect(ownerPredicateEnd).toBeGreaterThan(ownerPredicateStart);
    expect(controllerOptions).toContain(
      "debugBreakpointNavigationCaptureReader?: DebugBreakpointNavigationCaptureReader | null;",
    );
    expect(controllerContracts).toContain(
      "export interface WorkbenchControllerOptions extends WorkbenchDebugControllerOptions {",
    );
    expect(controller).toContain("options: WorkbenchControllerOptions = {},");
    expect(composition).toContain("captureReader: options.debugBreakpointNavigationCaptureReader,");
    expect(composition).toContain("getBreakpoints: () => debugSession.breakpoints,");
    expect(composition).toContain("isWorkspaceCurrent: isCurrentJavaScriptEditorWorkspaceOwner,");
    expect(ownerPredicates).toMatch(
      /(?:Boolean\(workspaceDescriptor\?\.javaScriptTypeScript\)|!!workspaceDescriptor\?\.javaScriptTypeScript)\s*&&/u,
    );
    expect(ownerPredicates).toContain(
      "workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)",
    );
    expect(ownerPredicates).toContain("currentEditorSessionOwnerKeyRef.current === ownerKey");
    expect(ownerPredicates).toContain("isCurrentEditorWorkspaceOwner(rootPath, ownerKey)");
    expect(composition).toContain("openDebugLocation,");
    expect(composition).not.toContain("debugGateway");
    expect(composition).not.toContain("isWorkspaceTrusted");
    expect(composition).not.toContain("snapshot");
    expect(controller).toContain("debugBreakpointNavigation,");
  });

  it("routes only the active scoped editor reader into the controller", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

    expect(app).toContain(
      "updateDebugBreakpointNavigationCapture: updateDebugBreakpointNavigationCaptureReader,",
    );
    expect(app).toContain(
      "debugBreakpointNavigationCapture: debugBreakpointNavigationCaptureReader,",
    );
    expect(app).toContain("debugBreakpointNavigationCaptureReader,");
    expect(app).toContain("onDebugBreakpointNavigationCaptureReaderChange={");
    expect(app).toContain("updateDebugBreakpointNavigationCaptureReader");
  });
});
