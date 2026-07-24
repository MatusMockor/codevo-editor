import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench Restart Frame composition", () => {
  it("routes only the narrow owner-fenced command port to commands and UI", () => {
    const controller = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const start = controller.indexOf("const debugRestartFrame = useDebugRestartFrame({");
    const end = controller.indexOf("\n  });", start);
    const composition = controller.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(composition).toContain("canRestartFrame: debugSession.canRestartFrame,");
    expect(composition).toContain("getDebugAdapterKind: () => debugSession.debugAdapterKind,");
    expect(composition).toContain("getPauseOwner: () => debugSession.pauseOwner,");
    expect(composition).toContain("getSelectedFrameId: () => debugSession.selectedFrameId,");
    expect(composition).toContain("getSnapshot: () => debugSession.snapshot,");
    expect(composition).toContain("isWorkspaceTrusted,");
    expect(composition).toContain("restartFrame: debugSession.restartFrame,");
    expect(controller.match(/debugRestartFrame,/g)).toHaveLength(2);

    const panelComposition = readFileSync(
      new URL("../components/useAppTestDebugPanels.ts", import.meta.url),
      "utf8",
    );
    expect(panelComposition).toContain("debugRestartFrame: workbench.debugRestartFrame,");
  });
});
