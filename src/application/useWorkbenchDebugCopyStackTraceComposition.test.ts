import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Copy Call Stack composition", () => {
  it("derives a generic stopped-session context without changing debug lifecycle policy", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const orchestration = readFileSync(
      new URL("./useWorkbenchDebugOrchestration.ts", import.meta.url),
      "utf8",
    );
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
    const start = orchestration.indexOf("const debugCopyStackTrace = useDebugCopyStackTrace({");
    const end = orchestration.indexOf("\n  });", start);
    const composition = orchestration.slice(start, end);
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
    const publicSurface = coordinatorPublicSurface(editorNavigationCoordinator);
    const projection = rootController.slice(rootController.indexOf("\n  return {", commandsStart));

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(app).toContain(
      'import { BrowserTextClipboardGateway } from "./infrastructure/browserTextClipboardGateway";',
    );
    expect(app).toContain("const debugTextClipboard = new BrowserTextClipboardGateway();");
    expect(app).toContain("debugTextClipboard,");
    expect(controllerOptions).toContain("debugTextClipboard?: TextClipboardGateway | null;");
    expect(controllerContracts).toContain(
      "export interface WorkbenchControllerOptions extends WorkbenchDebugControllerOptions {",
    );
    expect(controller).toContain("type WorkbenchTaskDebugOptions = Pick<");
    expect(controller).toContain("options: WorkbenchTaskDebugOptions;");
    expect(controller).toContain("debugTextClipboard: options.debugTextClipboard,");
    expect(orchestration).toContain("debugTextClipboard = null,");
    expect(orchestration).toContain("debugTextClipboard?: TextClipboardGateway | null;");
    expect(composition).toContain("clipboard: debugTextClipboard,");
    expect(composition).toContain("const owner = debugSession.pauseOwner;");
    expect(composition).toContain('state.kind === "stopped"');
    expect(composition).toContain("owner && owner.sessionId === state.sessionId");
    expect(composition).toContain("frames: state.frames,");
    expect(composition).toContain("pauseGeneration: owner.pauseGeneration,");
    expect(composition).toContain("rootKey: owner.rootKey,");
    expect(composition).toContain("sessionId: owner.sessionId,");
    expect(composition).toContain("workspaceOwnerKey: owner.workspaceOwnerKey,");
    expect(composition).not.toContain("debugAdapterKind");
    expect(composition).not.toContain("workspaceTrusted");
    expect(composition).not.toContain("startDebug");
    expect(composition).not.toContain("stopDebug");
    expect(orchestration).toContain("debugCopyStackTrace,");
    expect(controller).toContain("...debug,");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("publicSurface: editorNavigationSurface,");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}debugCopyStackTrace,$/mu);
    expect(commands).toMatch(/^ {4}debugCopyStackTrace: taskDebug\.debugCopyStackTrace,$/mu);
    expect(publicSurface).toMatch(/^ {6}debugCopyStackTrace,$/mu);
    expect(projection).toMatch(/^ {4}\.\.\.editorNavigationSurface,$/mu);
  });

  it("projects only the narrow command capability into the Debug panel", () => {
    const panelComposition = readFileSync(
      new URL("../components/useAppTestDebugPanels.ts", import.meta.url),
      "utf8",
    );
    const panelProps = readFileSync(
      new URL("../components/useDebugPanelProps.ts", import.meta.url),
      "utf8",
    );
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );

    expect(panelComposition).toContain("debugCopyStackTrace: workbench.debugCopyStackTrace,");
    expect(panelProps).toContain("readonly debugCopyStackTrace?: DebugCopyStackTraceCommand;");
    expect(panelProps).toContain("debugCopyStackTrace,");
    expect(panelComposition).not.toContain("state.frames");
    expect(panelComposition).not.toContain("condition");
    expect(panelComposition).not.toContain("logMessage");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
  });
});

function coordinatorPublicSurface(source: string): string {
  const start = source.indexOf("publicSurface: {");
  return source.slice(start, source.indexOf("\n    statusBar:", start));
}
