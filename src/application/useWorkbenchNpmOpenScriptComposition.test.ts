import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench npm open-script composition", () => {
  it("injects the source gateway, binds it to controller authority, and exposes navigation", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
      "utf8",
    );
    const editorNavigationCoordinator = readFileSync(
      new URL("./workbenchController/useWorkbenchEditorNavigationCoordinator.ts", import.meta.url),
      "utf8",
    );
    const composition = readFileSync(
      new URL("./useWorkbenchNpmOpenScriptNavigation.ts", import.meta.url),
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
    const publicSurface = coordinatorPublicSurface(editorNavigationCoordinator);
    const projection = rootController.slice(rootController.indexOf("\n  return {", rootBindingEnd));

    expect(app).toContain("workspaceSourceDiscoveryGateway,");
    expect(composition).toContain("bindNpmOpenScriptNavigation(readGatewayOwner)");
    expect(controller).toContain("useWorkbenchNpmOpenScriptNavigation({");
    expect(controller).toContain("openNodePackageScript,");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("publicSurface: editorNavigationSurface,");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}openNodePackageScript,$/mu);
    expect(publicSurface).toMatch(/^ {6}openNodePackageScript,$/mu);
    expect(projection).toMatch(/^ {4}\.\.\.editorNavigationSurface,$/mu);
  });
});

function coordinatorPublicSurface(source: string): string {
  const start = source.indexOf("publicSurface: {");
  return source.slice(start, source.indexOf("\n    statusBar:", start));
}
