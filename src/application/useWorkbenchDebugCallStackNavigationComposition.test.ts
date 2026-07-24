import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Call Stack navigation composition", () => {
  it("routes the owner-fenced navigation port into the command registry", () => {
    const controller = readFileSync(new URL("./useWorkbenchController.ts", import.meta.url), "utf8");
    const start = controller.indexOf(
      "const debugCallStackNavigation = useDebugCallStackNavigation({",
    );
    const end = controller.indexOf("\n  });", start);
    const composition = controller.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(composition).toContain("getPauseOwner: () => debugSession.pauseOwner,");
    expect(composition).toContain("getSelectedFrameId: () => debugSession.selectedFrameId,");
    expect(composition).toContain("getSnapshot: () => debugSession.snapshot,");
    expect(composition).toContain("selectFrame: debugSession.selectFrame,");
    expect(controller).toContain("debugCallStackNavigation,");
  });
});
