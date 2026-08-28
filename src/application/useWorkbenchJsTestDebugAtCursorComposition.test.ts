import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench JavaScript Debug Test at Cursor composition", () => {
  it("composes the atomic scoped capture with owner, trust, idle, and accepted-start ports", () => {
    const controller = readFileSync(
      new URL("./workbenchController/useWorkbenchTaskDebugCoordinator.ts", import.meta.url),
      "utf8",
    );
    const editorNavigationCoordinator = readFileSync(
      new URL("./workbenchController/useWorkbenchEditorNavigationCoordinator.ts", import.meta.url),
      "utf8",
    );
    const hook = readFileSync(
      new URL("./useWorkbenchJsTestCursorDebugging.ts", import.meta.url),
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
    const start = controller.indexOf("const cursorDebug = useWorkbenchJsTestCursorDebugging({");
    const end = controller.indexOf("});", start);
    const composition = controller.slice(start, end);
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

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(composition).toContain("activeDocument: () => activeDocumentRef.current,");
    expect(composition).toContain("captureReader: options.debugWatchAtCursorCaptureReader,");
    expect(composition).toContain("isDebugStartBlocked: debug.debugSession.isDebugStartBlocked,");
    expect(composition).toContain("isWorkspaceCurrent: isCurrentJavaScriptEditorWorkspaceOwner,");
    expect(composition).toContain("isWorkspaceTrusted,");
    expect(composition).toContain("readTextFileBounded: workspaceFiles.readTextFileBounded,");
    expect(composition).toContain("startDebugAccepted: debug.debugSession.startDebugAccepted,");
    expect(composition).toContain("workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,");
    expect(hook).toContain("activationEpoch,");
    expect(hook).toContain("captureReader,");
    expect(hook).toContain("readTextFileBounded: readBounded,");
    expect(hook).toContain("ownerKey !== ownerKey");
    expect(hook).toContain("captureReader !== activationReader");
    expect(rootController).toContain("useWorkbenchEditorNavigationCoordinator({");
    expect(rootController).toContain("taskDebug,");
    expect(editorNavigationCoordinator).toContain("taskDebug: {");
    expect(rootBinding).toMatch(/^ {4}debugWatchAtCursor,$/mu);
    expect(rootBinding).toMatch(/^ {4}jsTestDebugAtCursor,$/mu);
    expect(rootBinding).toMatch(/^ {4}jsTestRunSelection,$/mu);
    expect(commands).toMatch(/^ {4}debugWatchAtCursor: taskDebug\.debugWatchAtCursor,$/mu);
    expect(commands).toMatch(/^ {4}jsTestDebugAtCursor: taskDebug\.jsTestDebugAtCursor,$/mu);
    expect(commands).toMatch(/^ {4}jsTestRunSelection: taskDebug\.jsTestRunSelection,$/mu);
  });
});
