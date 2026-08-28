import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("VS Code process-task workbench composition", () => {
  it("keeps gateway construction, controller authority, and sidebar presentation separated", () => {
    const app = source("../App.tsx");
    const composition = source("../workbenchComposition.ts");
    const controller = source("./workbenchController/useWorkbenchTaskDebugCoordinator.ts");
    const editorNavigationCoordinator = source(
      "./workbenchController/useWorkbenchEditorNavigationCoordinator.ts",
    );
    const controllerContracts = source("./workbenchControllerContracts.ts");
    const taskComposition = source("./useWorkbenchVscodeProcessTasks.ts");
    const sidebar = source("../components/WorkbenchSidebar.tsx");
    const rootController = source("./useWorkbenchController.ts");
    const commandEffects = source("./workbenchController/useWorkbenchCommandEffectsCoordinator.ts");
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

    expect(composition).toContain(
      "vscodeProcessTasksGateway: new TauriVscodeProcessTasksGateway(),",
    );
    expect(app).toContain("vscodeProcessTasksGateway,");
    expect(controllerContracts).toContain("vscodeProcessTasksGateway?: VscodeProcessTasksGateway;");
    expect(controller).toContain("gateway: options.vscodeProcessTasksGateway,");
    expect(controller).toContain(
      "configurationVersion: workspaceDiscoveryVersions.vscodeProcessTasksVersion,",
    );
    expect(controller).toContain("workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,");
    expect(controller).toContain("requestTerminalSession: terminal.requestActiveTerminalSession,");
    expect(controller).toContain("setNotices,");
    expect(controller).toContain("vscodeProcessTasks: vscodeProcessTaskComposition.state,");
    expect(taskComposition).toContain("new Promise<number | null>");
    expect(taskComposition).toContain("requestTerminalSession(resolve);");
    expect(taskComposition).toContain(
      "useNodePackageTaskProblemNoticeComposition(state.problemNotices, setNotices);",
    );
    expect(sidebar).toContain("vscodeProcessTasks={workbench.vscodeProcessTasks}");
    expect(controller).not.toContain("VscodeProcessTasksPanel");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("publicSurface: editorNavigationSurface,");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}vscodeProcessTaskComposition,$/mu);
    expect(commands).toMatch(
      /^ {4}vscodeProcessTasksWorkbench: taskDebug\.vscodeProcessTaskComposition\.commands,$/mu,
    );
    expect(publicSurface).toMatch(
      /^ {6}vscodeProcessTasks: vscodeProcessTaskComposition\.state,$/mu,
    );
    expect(projection).toMatch(/^ {4}\.\.\.editorNavigationSurface,$/mu);
  });
});

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function coordinatorPublicSurface(source: string): string {
  const start = source.indexOf("publicSurface: {");
  return source.slice(start, source.indexOf("\n    statusBar:", start));
}
