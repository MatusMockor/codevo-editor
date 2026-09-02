import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("App agent and updater composition", () => {
  it("wires discovery into the controller and requires the owned updater settings surface", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("agentCliDiscoveryGateway,");
    expect(source).not.toContain("agentCliVersionGateway");
    expect(source).toContain(
      "<WorkbenchAppUpdaterHost\n        composition={workbenchComposition.appUpdater}",
    );
  });
});
