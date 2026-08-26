import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench npm open-script composition", () => {
  it("injects the source gateway, binds it to controller authority, and exposes navigation", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
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
    const rootBindingEnd = rootController.indexOf("} = useWorkbenchTaskDebugCoordinator({");
    const rootBinding = rootController.slice(
      rootController.lastIndexOf("  const {", rootBindingEnd),
      rootBindingEnd,
    );
    const projection = rootController.slice(rootController.indexOf("\n  return {", rootBindingEnd));

    expect(app).toContain("workspaceSourceDiscoveryGateway,");
    expect(composition).toContain("bindNpmOpenScriptNavigation(readGatewayOwner)");
    expect(controller).toContain("useWorkbenchNpmOpenScriptNavigation({");
    expect(controller).toContain("openNodePackageScript,");
    expect(rootBinding).toMatch(/^ {4}openNodePackageScript,$/mu);
    expect(projection).toMatch(/^ {4}openNodePackageScript,$/mu);
  });
});
