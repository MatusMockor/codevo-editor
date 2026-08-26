import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("VS Code process-task workbench composition", () => {
  it("keeps gateway construction, controller authority, and sidebar presentation separated", () => {
    const app = source("../App.tsx");
    const composition = source("../workbenchComposition.ts");
    const controller = source("./workbenchController/useWorkbenchTaskDebugCoordinator.ts");
    const controllerContracts = source("./workbenchControllerContracts.ts");
    const taskComposition = source("./useWorkbenchVscodeProcessTasks.ts");
    const sidebar = source("../components/WorkbenchSidebar.tsx");
    const rootController = source("./useWorkbenchController.ts");
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
    expect(rootBinding).toMatch(/^ {4}vscodeProcessTaskComposition,$/mu);
    expect(commands).toMatch(
      /^ {4}vscodeProcessTasksWorkbench: vscodeProcessTaskComposition\.commands,$/mu,
    );
    expect(projection).toMatch(/^ {4}vscodeProcessTasks: vscodeProcessTaskComposition\.state,$/mu);
  });
});

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
