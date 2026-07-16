import { describe, expect, it } from "vitest";
import {
  editorSurfaceCommandInvocationScopesEqual,
  editorSurfaceCommandIds,
  type EditorSurfaceCommandInvocationScope,
  type EditorSurfaceCommandRunner,
} from "./editorSurfaceCommand";
import { createLegacyEditorSessionOwnerKey } from "./editorSessionOwnerKey";
import { keymapCommands } from "./keymap";

describe("editorSurfaceCommandIds", () => {
  it("keeps every surface command represented in the keymap", () => {
    const keymapCommandIds = new Set(keymapCommands.map(({ id }) => id));

    expect(
      editorSurfaceCommandIds.filter((id) => !keymapCommandIds.has(id)),
    ).toEqual([]);
  });

  it("supports capturing and validating an owner/document/model snapshot", () => {
    const modelIdentity = {};
    const scope: EditorSurfaceCommandInvocationScope = {
      documentPath: "/project/src/example.ts",
      modelIdentity,
      ownerKey: createLegacyEditorSessionOwnerKey("/project"),
      surfaceIdentity: {},
    };
    const runner = (() => undefined) as EditorSurfaceCommandRunner;
    runner.captureScope = () => scope;
    runner.isScopeCurrent = (candidate) =>
      candidate.ownerKey === scope.ownerKey &&
      candidate.documentPath === scope.documentPath &&
      candidate.modelIdentity === scope.modelIdentity;

    expect(runner.captureScope()).toBe(scope);
    expect(runner.isScopeCurrent(scope)).toBe(true);
    expect(runner.isScopeCurrent({ ...scope, modelIdentity: {} })).toBe(false);
    expect(
      editorSurfaceCommandInvocationScopesEqual(scope, {
        ...scope,
        surfaceIdentity: {},
      }),
    ).toBe(false);
  });
});
