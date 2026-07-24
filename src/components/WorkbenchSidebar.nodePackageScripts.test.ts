import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("WorkbenchSidebar node package script composition", () => {
  it("wires the required panel open action to the controller navigation", () => {
    const source = readFileSync(new URL("./WorkbenchSidebar.tsx", import.meta.url), "utf8");

    expect(source).toContain("onOpen: (script) => void workbench.openNodePackageScript(script)");
    expect(source).toContain("vscodeProcessTasks={workbench.vscodeProcessTasks}");
  });
});
