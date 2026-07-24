import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Node run composition", () => {
  it("composes the lifecycle through the injected gateway and returns one capability", () => {
    const controller = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

    expect(controller).toContain(
      "const nodeRunWithoutDebugging = useWorkbenchNodeRunWithoutDebugging({",
    );
    expect(controller).toContain(
      "gateway: options.nodeRunTaskGateway ?? unavailableNodeRunTaskGateway,",
    );
    expect(controller).toContain("nodeRunWithoutDebugging,");
    expect(app).toContain("nodeRunTaskGateway,");
  });

  it("gates the command capability against active debug ownership", () => {
    const composition = readFileSync(
      new URL("./useWorkbenchNodeRunWithoutDebugging.ts", import.meta.url),
      "utf8",
    );

    expect(composition).toContain("canRun: canRunNodeWithoutDebugging({");
    expect(composition).toContain("debugSessionKind: debugSession.snapshot.state.kind,");
    expect(composition).toContain("debugStartPending: debugSession.debugStartPending,");
    expect(composition).toContain("isDebuggableNodeScriptPath(activeDocument.path)");
  });

  it("shares one instance-scoped picker coordinator between Debug and Run", () => {
    const controller = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const orchestration = readFileSync(
      new URL("./useWorkbenchDebugOrchestration.ts", import.meta.url),
      "utf8",
    );

    expect(controller.match(/useMemo\(createNodeLaunchPickerCoordinator, \[\]\)/g)).toHaveLength(1);
    expect(controller).toContain("configurationPickerCoordinator: nodeLaunchPickerCoordinator,");
    expect(orchestration).toContain("coordinator: configurationPickerCoordinator,");
  });

  it("renders only the sanitized Run picker projection at App overlay level", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const host = readFileSync(
      new URL("../components/NodeRunConfigurationPickerHost.tsx", import.meta.url),
      "utf8",
    );

    expect(app).toContain("<NodeRunConfigurationPickerHost");
    expect(app).toContain("launcher={workbench.nodeRunWithoutDebugging.configurationLauncher}");
    expect(host).toContain('intent="run"');
    expect(host).not.toContain("startTarget");
  });

  it("routes command, toolbar gear, and Settings edit through one controlled dialog", () => {
    const controller = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const panels = readFileSync(
      new URL("../components/useAppTestDebugPanels.ts", import.meta.url),
      "utf8",
    );
    const host = readFileSync(
      new URL("../components/WorkbenchSettingsDialogHost.tsx", import.meta.url),
      "utf8",
    );

    expect(controller).toContain("const nodeLaunchConfigurationsSurface =");
    expect(controller).toContain(
      "configureNodeLaunchConfigurations: nodeLaunchConfigurationsSurface.openNodeLaunchConfigurations,",
    );
    expect(controller).toContain("...nodeLaunchConfigurationsSurface,");
    expect(panels).toContain(
      "openNodeLaunchConfigurations: workbench.openNodeLaunchConfigurations,",
    );
    expect(host).toContain("isOpen: workbench.nodeLaunchConfigurationsOpen,");
    expect(host).toContain("onClose: workbench.closeNodeLaunchConfigurations,");
    expect(host).toContain(
      "onOpenNodeLaunchConfigurations={workbench.openNodeLaunchConfigurations}",
    );
    expect(host.match(/<NodeLaunchConfigurationsDialog/g)).toHaveLength(1);
  });
});
