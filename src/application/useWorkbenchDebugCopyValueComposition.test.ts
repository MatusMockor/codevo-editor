import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Copy Value composition", () => {
  it("reuses one text clipboard and keeps App/controller as typed plumbing", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
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
    const commandBridges = readFileSync(
      new URL("./useDebugCommandBridges.ts", import.meta.url),
      "utf8",
    );
    const orchestration = readFileSync(
      new URL("./useWorkbenchDebugOrchestration.ts", import.meta.url),
      "utf8",
    );
    const appPanels = readFileSync(
      new URL("../components/useAppTestDebugPanels.ts", import.meta.url),
      "utf8",
    );
    const panelComposition = readFileSync(
      new URL("../components/useDebugPanelProps.ts", import.meta.url),
      "utf8",
    );
    const debugPanel = readFileSync(
      new URL("../components/DebugPanel.tsx", import.meta.url),
      "utf8",
    );
    const bridge = readFileSync(
      new URL("./debugCopyValueCommandBridge.ts", import.meta.url),
      "utf8",
    );
    const rootComposition = readFileSync(
      new URL("../workbenchComposition.ts", import.meta.url),
      "utf8",
    );
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const rootBindingEnd = editorNavigationCoordinator.indexOf(
      "} = useWorkbenchTaskDebugCoordinator({",
    );
    const rootBinding = editorNavigationCoordinator.slice(
      editorNavigationCoordinator.lastIndexOf("  const {", rootBindingEnd),
      rootBindingEnd,
    );
    const projection = rootController.slice(rootController.indexOf("\n  return {"));
    expect(rootComposition).toContain(
      'import { BrowserTextClipboardGateway } from "./infrastructure/browserTextClipboardGateway";',
    );
    expect(
      rootComposition.match(/debugTextClipboard: new BrowserTextClipboardGateway\(\),/gu),
    ).toHaveLength(1);
    expect(app).not.toContain("new BrowserTextClipboardGateway()");
    expect(app).toContain("debugTextClipboard,");
    expect(controllerOptions).toContain("debugTextClipboard?: TextClipboardGateway | null;");
    expect(controllerContracts).toContain(
      "export interface WorkbenchControllerOptions extends WorkbenchDebugControllerOptions {",
    );
    expect(controller).toContain("type WorkbenchTaskDebugOptions = Pick<");
    expect(controller).toContain("options: WorkbenchTaskDebugOptions;");
    expect(controller).toContain("debugTextClipboard: options.debugTextClipboard,");
    expect(orchestration).toContain("debugTextClipboard = null,");
    expect(app).toContain("const debugCommandBridges = useDebugCommandBridges();");
    expect(app).toContain("...debugCommandBridges.controllerOptions,");
    expect(commandBridges).toContain("debugCopyValueCommands: copyValue.commands,");
    expect(commandBridges).toContain("debugCopyEvaluatePathOnce: copyValue.copyEvaluatePathOnce,");
    expect(controller).not.toContain("DebugCopyValueCandidate");
    expect(controller).not.toContain("setFocusedCandidate");
    expect(controller).not.toContain("DebugCopyValueCommandBridge");
    expect(controller).not.toContain("debugCopyValueBind");
    expect(app).not.toContain("DebugCopyValueCandidate");
    expect(appPanels).toContain("const debugPanel = usePrivateDebugPanelElement(");
    expect(appPanels).toContain("debugPanelProps,");
    expect(orchestration.match(/clipboard: debugTextClipboard,/gu)).toHaveLength(1);
    expect(orchestration).not.toContain("useDebugCopyValueComposition({");
    expect(orchestration).not.toContain("import { useDebugCopyValueComposition }");
    expect(orchestration).toContain("copyValue: debugCopyValueCommands,");
    expect(panelComposition).not.toContain("debugCopyValue:");
    expect(debugPanel).toContain("copyValueSurface={debugCopyValue?.variables}");
    expect(debugPanel).toContain("copyValueSurface={debugCopyValue?.watch}");
    expect(rootComposition).not.toContain("debugCopyValueCommandBridge");
    expect(bridge).not.toContain("WeakMap");
    expect(bridge).not.toContain("BridgeForClipboard");
    expect(bridge).not.toContain("registerDebugCopyValueClipboardBridge");
    expect(app.indexOf("const debugCommandBridges = useDebugCommandBridges();")).toBeGreaterThan(
      app.indexOf("function App()"),
    );
    expect(commandBridges).toContain("return useMemo(() => {");
    expect(commandBridges).toContain("const copyValue = createDebugCopyValueCommandBridge();");
    expect(controller).toContain("...debug,");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}debugSession,$/mu);
    expect(projection).toMatch(/^ {4}\.\.\.editorNavigationSurface,$/mu);
    expect(projection).toContain("debugSession: {");
  });
});
