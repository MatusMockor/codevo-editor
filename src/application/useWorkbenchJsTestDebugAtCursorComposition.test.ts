import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench JavaScript Debug Test at Cursor composition", () => {
  it("composes the atomic scoped capture with owner, trust, idle, and accepted-start ports", () => {
    const controller = readFileSync(
      new URL("./useWorkbenchController.ts", import.meta.url),
      "utf8",
    );
    const hook = readFileSync(
      new URL("./useWorkbenchJsTestCursorDebugging.ts", import.meta.url),
      "utf8",
    );
    const start = controller.indexOf(
      "const { debugWatchAtCursor, jsTestDebugAtCursor, jsTestRunSelection } =",
    );
    const end = controller.indexOf("});", start);
    const composition = controller.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(composition).toContain("activeDocument: () => activeDocumentRef.current,");
    expect(composition).toContain("captureReader: options.debugWatchAtCursorCaptureReader,");
    expect(composition).toContain("isDebugStartBlocked: debugSession.isDebugStartBlocked,");
    expect(composition).toContain(
      "isWorkspaceCurrent: isCurrentJavaScriptEditorWorkspaceOwner,",
    );
    expect(composition).toContain("isWorkspaceTrusted,");
    expect(composition).toContain("readTextFileBounded: workspaceFiles.readTextFileBounded,");
    expect(composition).toContain("startDebugAccepted: debugSession.startDebugAccepted,");
    expect(composition).toContain(
      "workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,",
    );
    expect(hook).toContain("activationEpoch,");
    expect(hook).toContain("captureReader,");
    expect(hook).toContain("readTextFileBounded: readBounded,");
    expect(hook).toContain("ownerKey !== ownerKey");
    expect(hook).toContain("captureReader !== activationReader");
  });
});
