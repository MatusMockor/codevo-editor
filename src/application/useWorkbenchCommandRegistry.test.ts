import { describe, expect, it, vi } from "vitest";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorSurfaceCommandInvocationScope } from "../domain/editorSurfaceCommand";
import type { Command, CommandContext } from "./commandRegistry";
import { scopedNavigationCommands } from "./useWorkbenchCommandRegistry";

const ownerA = createLegacyEditorSessionOwnerKey("/project-a");
const ownerB = createLegacyEditorSessionOwnerKey("/project-b");

describe("scopedNavigationCommands", () => {
  it("runs a current owner/document/model invocation", () => {
    const model = {};
    let currentScope = scope(ownerA, "/project-a/a.ts", model);
    const run = vi.fn();
    const command = scopedCommand(run, (candidate) =>
      sameScope(candidate, currentScope),
    );
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
    const command = scopedCommand(run, (candidate) =>
      sameScope(candidate, currentScope),
    );
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
    const command = scopedCommand(run, (candidate) =>
      sameScope(candidate, currentScope),
    );
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
    const command = scopedCommand(run, (candidate) =>
      sameScope(candidate, currentScope),
    );
    const context = commandContext(invocation);

    currentScope = scope(ownerA, null, null, {});
    currentScope = scope(ownerA, null, null, {});
    command.run(context);

    expect(run).not.toHaveBeenCalled();
    expect(command.isEnabled(context)).toBe(false);
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

function commandContext(
  editorSurfaceScope: EditorSurfaceCommandInvocationScope,
): CommandContext {
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
