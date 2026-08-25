import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorSurfaceCommandInvocationScope } from "../domain/editorSurfaceCommand";
import type { Command, CommandContext } from "./commandRegistry";
import {
  canShowWorkspaceExpressRoutes,
  scopedNavigationCommands,
} from "./useWorkbenchCommandRegistry";

const ownerA = createLegacyEditorSessionOwnerKey("/project-a");
const ownerB = createLegacyEditorSessionOwnerKey("/project-b");

describe("debug command registration", () => {
  it("projects the private Explorer bridge into verb-only rerun commands", () => {
    const source = readFileSync(new URL("./useWorkbenchController.ts", import.meta.url), "utf8");

    expect(source).toContain("createJsTestRerunLastRunCommands(options.jsTestExplorerScopeRunner)");
    expect(source).toContain(
      "jsTestRerunLastRun: createJsTestRerunLastRunCommands(options.jsTestExplorerScopeRunner),",
    );
  });

  it("forwards the owner-safe JavaScript test-at-cursor coordinator", () => {
    const source = readFileSync(
      new URL("./useWorkbenchCommandRegistry.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("workbenchJsTestCommands({");
    const end = source.indexOf("}).forEach((command) => registry.register(command));", start);
    const registration = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(registration).toContain("canDebugAtCursor: jsTestDebugAtCursor.canDebugAtCursor,");
    expect(registration).toContain("canRunAtCursor: jsTestRunSelection.canRunAtCursor,");
    expect(registration).toContain("canRunCurrentFile: jsTestRunSelection.canRunCurrentFile,");
    expect(registration).toContain("canCancelTestRun: jsTestRerunLastRun.canCancelTestRun,");
    expect(registration).toContain("canRerunFailedTests: jsTestRerunLastRun.canRerunFailedTests,");
    expect(registration).toContain("canRerunLastRun: jsTestRerunLastRun.canRerunLastRun,");
    expect(registration).toContain("await jsTestDebugAtCursor.debugAtCursor();");
    expect(registration).toContain("await jsTestRunSelection.runAtCursor();");
    expect(registration).toContain("await jsTestRunSelection.runCurrentFile();");
    expect(registration).toContain("cancelTestRun: jsTestRerunLastRun.cancelTestRun,");
    expect(registration).toContain("rerunFailedTests: jsTestRerunLastRun.rerunFailedTests,");
    expect(registration).toContain("rerunLastRun: jsTestRerunLastRun.rerunLastRun,");
    expect(registration.match(/canCancelTestRun:/g)).toHaveLength(1);
    expect(registration.match(/canRerunFailedTests:/g)).toHaveLength(1);
    expect(registration.match(/cancelTestRun:/g)).toHaveLength(1);
    expect(registration.match(/rerunFailedTests:/g)).toHaveLength(1);
    expect(registration).toContain("shortcut,");
    expect(registration).not.toContain("runTestForActiveDocument: runAtCursor");
    expect(registration).not.toContain("runAllTestsForActiveDocument: runCurrentFile");
  });

  it("forwards the exact debug session capabilities", () => {
    const source = readFileSync(
      new URL("./useWorkbenchCommandRegistry.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("workbenchDebugCommands({");
    const end = source.indexOf("}).forEach((command) => registry.register(command));", start);
    const registration = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(registration).toContain("canRestartDebug: debugState.canRestartDebug(),");
    expect(registration).toContain("canRunToCursor: debugState.canRunToCursor,");
    expect(registration).toContain("canClearDebugConsole: debugState.consoleSurface.canClear,");
    expect(registration).toContain(
      "breakpointBulkMutationPending: debugState.breakpointBulkMutationPending,",
    );
    expect(registration).toContain("breakpointCounts: debugState.breakpointCounts,");
    expect(registration).toContain("configurationLauncher: debugState.configurationLauncher,");
    expect(registration).toContain("configureNodeLaunchConfigurations,");
    expect(registration).toContain("debugRestartPending: debugState.debugRestartPending,");
    expect(registration).toContain("debugControlPending: debugState.debugControlPending,");
    expect(registration).toContain("debugStopPending: debugState.debugStopPending,");
    expect(registration).toContain("debugStartPending: debugState.debugStartPending,");
    expect(registration).toContain("debugEvaluateInConsole,");
    expect(registration).toContain("debugBreakpointNavigation,");
    expect(registration).toContain("debugCallStackNavigation,");
    expect(registration).toContain("debugRestartFrame,");
    expect(registration).toContain("debugSetVariable: debugState.setValue,");
    expect(registration).toContain("debugCopyValue: debugState.copyValue,");
    expect(registration).toContain("debugCopyStackTrace,");
    expect(registration).toContain("debugWatchAtCursor,");
    expect(registration).toContain("disableAllBreakpoints: debugState.disableAllBreakpoints,");
    expect(registration).toContain("enableAllBreakpoints: debugState.enableAllBreakpoints,");
    expect(registration).toContain("removeAllBreakpoints: debugState.removeAllBreakpoints,");
    expect(registration).toContain("restartDebug: debugState.restartDebug,");
    expect(registration).toContain("runToCursor: debugState.runToCursor,");
    expect(registration).toContain("clearDebugConsole: debugState.consoleSurface.clear,");
    expect(registration).toContain("focusDebugConsole: debugState.consoleSurface.focus,");
    expect(registration).toContain("snapshot: debugState.snapshot,");
    expect(source).toContain("const hasJsDebugWorkspace = hasDebuggableNodeWorkspace({");
    expect(source).toContain("openedDocuments: openDocuments,");
    expect(source).toContain("hasJsWorkspace: hasJsDebugWorkspace,");
    expect(source).toContain("(hasJsDebugWorkspace &&");
  });

  it("projects Run Without Debugging only through the owner-safe lifecycle capability", () => {
    const source = readFileSync(
      new URL("./useWorkbenchCommandRegistry.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("workbenchNodeRunCommands({");
    const end = source.indexOf("}).forEach((command) => registry.register(command));", start);
    const registration = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(registration).toContain("canRun: nodeRunWithoutDebugging.canRun,");
    expect(registration).toContain("canStop: nodeRunWithoutDebugging.canStop,");
    expect(registration).toContain(
      "configurationLauncher: nodeRunWithoutDebugging.configurationLauncher,",
    );
    expect(registration).toContain("pending: nodeRunWithoutDebugging.pending,");
    expect(registration).toContain("run: nodeRunWithoutDebugging.run,");
    expect(registration).toContain("shortcut,");
    expect(registration).toContain("stop: nodeRunWithoutDebugging.stop,");
  });

  it("routes the agent view commands through the shared view command bridge", () => {
    const source = readFileSync(
      new URL("./useWorkbenchCommandRegistry.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("workbenchAgentCommands({");
    const end = source.indexOf("}).forEach((command) => registry.register(command));", start);
    const registration = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(registration).toContain("shortcut,");
    expect(registration).toContain("toggleAgentMode,");
    expect(registration).toContain("viewCommands: workbenchAgentViewCommandBridge,");
  });
});

describe("scopedNavigationCommands", () => {
  it("runs a current owner/document/model invocation", () => {
    const model = {};
    const currentScope = scope(ownerA, "/project-a/a.ts", model);
    const run = vi.fn();
    const command = scopedCommand(run, (candidate) => sameScope(candidate, currentScope));
    const context = commandContext(currentScope);

    expect(command.isEnabled(context)).toBe(true);
    command.run(context);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(context);
  });

  it("rejects a deferred A to B to A invocation after model replacement", () => {
    const originalModel = {};
    const replacementModel = {};
    const invocation = scope(ownerA, "/project-a/a.ts", originalModel);
    let currentScope = invocation;
    const run = vi.fn();
    const command = scopedCommand(run, (candidate) => sameScope(candidate, currentScope));
    const context = commandContext(invocation);

    expect(command.isEnabled(context)).toBe(true);
    currentScope = scope(ownerB, "/project-b/b.ts", {});
    currentScope = scope(ownerA, "/project-a/a.ts", replacementModel);
    command.run(context);

    expect(run).not.toHaveBeenCalled();
    expect(command.isEnabled(context)).toBe(false);
  });

  it("rejects a deferred invocation after an active document switch", () => {
    const model = {};
    const invocation = scope(ownerA, "/project-a/a.ts", model);
    let currentScope = invocation;
    const run = vi.fn();
    const command = scopedCommand(run, (candidate) => sameScope(candidate, currentScope));
    const context = commandContext(invocation);

    currentScope = scope(ownerA, "/project-a/b.ts", model);
    command.run(context);

    expect(run).not.toHaveBeenCalled();
    expect(command.isEnabled(context)).toBe(false);
  });

  it.each([
    "editor.goToDefinition",
    "editor.goToSourceDefinition",
    "editor.goToDeclaration",
    "editor.goToTypeDefinition",
    "editor.goToImplementation",
    "editor.goToSuperMethod",
    "editor.findReferences",
    "editor.findFileReferences",
    "editor.showCallHierarchy",
    "editor.showTypeHierarchy",
    "navigation.back",
    "navigation.forward",
  ])("scopes %s through the same invocation fence", (commandId) => {
    const invocation = scope(ownerA, "/project-a/a.ts", {});
    const run = vi.fn();
    const [command] = scopedNavigationCommands(
      [baseCommand(commandId, run)],
      (candidate) => sameScope(candidate, invocation),
      invocation,
    );

    command.run();

    expect(run).toHaveBeenCalledOnce();
  });

  it("preserves owner-scoped transient Git navigation without a model", () => {
    const surfaceIdentity = {};
    const invocation = scope(ownerA, null, null, surfaceIdentity);
    const run = vi.fn();
    const [command] = scopedNavigationCommands(
      [baseCommand("navigation.back", run)],
      (candidate) => sameScope(candidate, invocation),
      invocation,
    );

    expect(command.isEnabled(commandContext(invocation))).toBe(true);
    command.run();

    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects model-less Git diff A to B to A after surface replacement", () => {
    const invocation = scope(ownerA, null, null, {});
    let currentScope = invocation;
    const run = vi.fn();
    const command = scopedCommand(run, (candidate) => sameScope(candidate, currentScope));
    const context = commandContext(invocation);

    currentScope = scope(ownerA, null, null, {});
    currentScope = scope(ownerA, null, null, {});
    command.run(context);

    expect(run).not.toHaveBeenCalled();
    expect(command.isEnabled(context)).toBe(false);
  });
});

describe("canShowWorkspaceExpressRoutes", () => {
  it("enables an open JS/TS workspace without requiring Express detection", () => {
    expect(
      canShowWorkspaceExpressRoutes("/workspace", {
        javaScriptTypeScript: {
          frameworks: [],
          hasPackageJson: true,
          hasJsconfig: false,
          hasTsconfig: true,
          packageManager: "npm",
          packageName: "workspace",
          packages: [
            {
              declaredRange: "workspace:*",
              dev: false,
              installedVersion: null,
              installPath: "packages/api",
              name: "@workspace/api",
            },
          ],
          typeScriptDependencyVersion: null,
          usesTypeScript: true,
          workspaceTypeScriptVersion: null,
        },
        php: null,
        rootPath: "/workspace",
      }),
    ).toBe(true);
  });

  it("disables missing, mismatched, and non-JS workspaces", () => {
    expect(canShowWorkspaceExpressRoutes(null, null)).toBe(false);
    expect(
      canShowWorkspaceExpressRoutes("/workspace", {
        javaScriptTypeScript: null,
        php: null,
        rootPath: "/workspace",
      }),
    ).toBe(false);
    expect(
      canShowWorkspaceExpressRoutes("/workspace", {
        javaScriptTypeScript: {
          frameworks: ["Express"],
          hasPackageJson: true,
          hasJsconfig: false,
          hasTsconfig: false,
          packageManager: "npm",
          packageName: null,
          typeScriptDependencyVersion: null,
          usesTypeScript: false,
          workspaceTypeScriptVersion: null,
        },
        php: null,
        rootPath: "/other",
      }),
    ).toBe(false);
  });
});

function scopedCommand(
  run: Command["run"],
  isScopeCurrent: (scope: EditorSurfaceCommandInvocationScope) => boolean,
): Command {
  const command = baseCommand("editor.goToDefinition", run);

  return scopedNavigationCommands([command], isScopeCurrent)[0];
}

function baseCommand(id: string, run: Command["run"]): Command {
  return {
    id,
    title: "Go to Definition",
    category: "Editor",
    isEnabled: () => true,
    run,
  };
}

function scope(
  ownerKey: EditorSurfaceCommandInvocationScope["ownerKey"],
  documentPath: string | null,
  modelIdentity: object | null,
  surfaceIdentity: object = modelIdentity ?? {},
): EditorSurfaceCommandInvocationScope {
  return {
    documentPath,
    modelIdentity,
    ownerKey,
    surfaceIdentity,
  };
}

function commandContext(editorSurfaceScope: EditorSurfaceCommandInvocationScope): CommandContext {
  return {
    activeDocumentDirty: false,
    editorSurfaceScope,
    hasActiveDocument: true,
    hasWorkspace: true,
  };
}

function sameScope(
  left: EditorSurfaceCommandInvocationScope,
  right: EditorSurfaceCommandInvocationScope,
): boolean {
  return (
    left.ownerKey === right.ownerKey &&
    left.documentPath === right.documentPath &&
    left.modelIdentity === right.modelIdentity &&
    left.surfaceIdentity === right.surfaceIdentity
  );
}
