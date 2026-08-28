import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Node run composition", () => {
  it("composes the lifecycle through the injected gateway and returns one capability", () => {
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
      "utf8",
    );
    const editorNavigationCoordinator = readFileSync(
      new URL("./workbenchController/useWorkbenchEditorNavigationCoordinator.ts", import.meta.url),
      "utf8",
    );
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const commandEffects = readFileSync(
      new URL("./workbenchController/useWorkbenchCommandEffectsCoordinator.ts", import.meta.url),
      "utf8",
    );
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

    expect(controller).toContain(
      "const nodeRunWithoutDebugging = useWorkbenchNodeRunWithoutDebugging({",
    );
    expect(controller).toContain(
      "gateway: options.nodeRunTaskGateway ?? unavailableNodeRunTaskGateway,",
    );
    expect(controller).toContain("nodeRunWithoutDebugging,");
    expect(app).toContain("nodeRunTaskGateway,");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("publicSurface: editorNavigationSurface,");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}nodeRunWithoutDebugging,$/mu);
    expect(commands).toMatch(
      /^ {4}nodeRunWithoutDebugging: taskDebug\.nodeRunWithoutDebugging,$/mu,
    );
    expect(publicSurface).toMatch(/^ {6}nodeRunWithoutDebugging,$/mu);
    expect(projection).toMatch(/^ {4}\.\.\.editorNavigationSurface,$/mu);
  });

  it("gates the command capability against active debug ownership", () => {
    const composition = readFileSync(
      new URL("./useWorkbenchNodeRunWithoutDebugging.ts", import.meta.url),
      "utf8",
    );
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );

    expect(composition).toContain("canRun: canRunNodeWithoutDebugging({");
    expect(composition).toContain("debugSessionKind: debugSession.snapshot.state.kind,");
    expect(composition).toContain("debugStartPending: debugSession.debugStartPending,");
    expect(composition).toContain("isDebuggableNodeScriptPath(activeDocument.path)");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
  });

  it("shares one instance-scoped picker coordinator between Debug and Run", () => {
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
      "utf8",
    );
    const editorNavigationCoordinator = readFileSync(
      new URL("./workbenchController/useWorkbenchEditorNavigationCoordinator.ts", import.meta.url),
      "utf8",
    );
    const orchestration = readFileSync(
      new URL("./useWorkbenchDebugOrchestration.ts", import.meta.url),
      "utf8",
    );
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );

    expect(controller.match(/useMemo\(createNodeLaunchPickerCoordinator, \[\]\)/g)).toHaveLength(1);
    expect(controller).toContain("configurationPickerCoordinator: nodeLaunchPickerCoordinator,");
    expect(orchestration).toContain("coordinator: configurationPickerCoordinator,");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
  });

  it("renders only the sanitized Run picker projection at App overlay level", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const host = readFileSync(
      new URL("../components/NodeRunConfigurationPickerHost.tsx", import.meta.url),
      "utf8",
    );
    const rootController = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );

    expect(app).toContain("<NodeRunConfigurationPickerHost");
    expect(app).toContain("launcher={workbench.nodeRunWithoutDebugging.configurationLauncher}");
    expect(host).toContain('intent="run"');
    expect(host).not.toContain("startTarget");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
  });

  it("routes command, toolbar gear, and Settings edit through one controlled dialog", () => {
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
      "utf8",
    );
    const editorNavigationCoordinator = readFileSync(
      new URL("./workbenchController/useWorkbenchEditorNavigationCoordinator.ts", import.meta.url),
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
    const panels = readFileSync(
      new URL("../components/useAppTestDebugPanels.ts", import.meta.url),
      "utf8",
    );
    const host = readFileSync(
      new URL("../components/WorkbenchSettingsDialogHost.tsx", import.meta.url),
      "utf8",
    );

    expect(controller).toContain("const nodeLaunchConfigurationsSurface =");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(commandEffects).toContain("configureNodeLaunchConfigurations:");
    expect(commandEffects).toContain(
      "taskDebug.nodeLaunchConfigurationsSurface.openNodeLaunchConfigurations,",
    );
    expect(rootController).toContain("...taskDebug.nodeLaunchConfigurationsSurface,");
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

function coordinatorPublicSurface(source: string): string {
  const start = source.indexOf("publicSurface: {");
  return source.slice(start, source.indexOf("\n    statusBar:", start));
}
