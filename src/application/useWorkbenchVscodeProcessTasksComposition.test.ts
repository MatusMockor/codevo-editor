import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("VS Code process-task workbench composition", () => {
  it("keeps gateway construction, controller authority, and scripts surface presentation separated", () => {
    const composition = source("../agentAppComposition.ts");
    const ports = source("./agentApp/agentAppPorts.ts");
    const appController = source("./agentApp/useAgentAppController.ts");
    const controller = source("./agentApp/useAgentWorkspaceTasks.ts");
    const taskComposition = source("./useWorkbenchVscodeProcessTasks.ts");
    const agentWorkbenchScreen = source("../components/agentMode/AgentWorkbenchScreen.tsx");

    expect(composition).toContain(
      "vscodeProcessTasksGateway: new TauriVscodeProcessTasksGateway(),",
    );
    expect(ports).toContain("readonly vscodeProcessTasksGateway: VscodeProcessTasksGateway;");
    expect(appController).toContain("vscodeProcessTasksGateway: ports.vscodeProcessTasksGateway,");
    expect(controller).toContain("gateway: vscodeProcessTasksGateway,");
    expect(controller).toContain("configurationVersion: vscodeProcessTasksVersion,");
    expect(controller).toContain("workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,");
    expect(controller).toContain("requestTerminalSession,");
    expect(controller).toContain("setNotices,");
    expect(taskComposition).toContain("new Promise<number | null>");
    expect(taskComposition).toContain("requestTerminalSession(resolve);");
    expect(taskComposition).toContain(
      "useNodePackageTaskProblemNoticeComposition(state.problemNotices, setNotices);",
    );
    expect(agentWorkbenchScreen).toContain(
      "const vscodeProcessTasks = workbench.vscodeProcessTasks ?? null;",
    );
    expect(controller).not.toContain("VscodeProcessTasksPanel");
  });
});

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
