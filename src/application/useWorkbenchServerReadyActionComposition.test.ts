import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("server-ready action workbench composition", () => {
  it("keeps the concrete desktop opener behind the typed controller and orchestration port", () => {
    const composition = source("../workbenchComposition.ts");
    const app = source("../App.tsx");
    const controllerOptions = source("./workbenchDebugControllerOptions.ts");
    const rootController = source("./useWorkbenchController.ts");
    const coordinator = source("./workbenchController/useWorkbenchTaskDebugCoordinator.ts");
    const editorNavigationCoordinator = source(
      "./workbenchController/useWorkbenchEditorNavigationCoordinator.ts",
    );
    const orchestration = source("./useWorkbenchDebugOrchestration.ts");
    const coordinatorCallStart = editorNavigationCoordinator.indexOf(
      "} = useWorkbenchTaskDebugCoordinator({",
    );
    const coordinatorCall = editorNavigationCoordinator.slice(
      coordinatorCallStart,
      editorNavigationCoordinator.indexOf("\n  });", coordinatorCallStart),
    );
    const coordinatorOptionsStart = coordinator.indexOf("type WorkbenchTaskDebugOptions = Pick<");
    const coordinatorOptions = coordinator.slice(
      coordinatorOptionsStart,
      coordinator.indexOf(";", coordinatorOptionsStart) + 1,
    );
    const debugCompositionStart = coordinator.indexOf(
      "const debug = useWorkbenchDebugOrchestration({",
    );
    const debugComposition = coordinator.slice(
      debugCompositionStart,
      coordinator.indexOf("\n  });", debugCompositionStart),
    );
    const rootBinding = editorNavigationCoordinator.slice(
      editorNavigationCoordinator.lastIndexOf("  const {", coordinatorCallStart),
      coordinatorCallStart,
    );
    const projection = rootController.slice(rootController.indexOf("\n  return {"));

    expect(composition).toContain(
      'import { TauriServerReadyExternalUrlOpener } from "./infrastructure/tauriServerReadyExternalUrlOpener";',
    );
    expect(composition).toContain(
      "serverReadyExternalUrlOpener: new TauriServerReadyExternalUrlOpener(),",
    );
    expect(app).toContain("serverReadyExternalUrlOpener,");
    expect(controllerOptions).toContain(
      "serverReadyExternalUrlOpener?: DebugServerReadyExternalUrlOpener;",
    );
    expect(coordinatorOptionsStart).toBeGreaterThanOrEqual(0);
    expect(debugCompositionStart).toBeGreaterThanOrEqual(0);
    expect(coordinator).toContain(
      'import type { WorkbenchControllerOptions } from "../workbenchControllerContracts";',
    );
    expect(coordinatorOptions).toContain('  | "serverReadyExternalUrlOpener"');
    expect(coordinator).toContain("options: WorkbenchTaskDebugOptions;");
    expect(coordinatorCall).toMatch(/^ {4}options: taskOptions,$/mu);
    expect(debugComposition).toContain(
      "serverReadyExternalUrlOpener: options.serverReadyExternalUrlOpener,",
    );
    expect(orchestration).toContain(
      "serverReadyExternalUrlOpener ?? unavailableServerReadyExternalUrlOpener,",
    );
    expect(coordinator).toContain("...debug,");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}debugSession,$/mu);
    expect(projection).toMatch(/^ {4}\.\.\.editorNavigationSurface,$/mu);
    expect(projection).toContain("debugSession: {");
    expect(app).not.toContain("TauriServerReadyExternalUrlOpener");
    expect(coordinator).not.toContain("TauriServerReadyExternalUrlOpener");
    expect(rootController).not.toContain("TauriServerReadyExternalUrlOpener");
  });
});

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
