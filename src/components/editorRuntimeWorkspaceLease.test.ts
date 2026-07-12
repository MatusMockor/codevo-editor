import { describe, expect, it } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  releaseEditorRuntimeWorkspace,
  retainEditorRuntimeWorkspace,
} from "./editorRuntimeWorkspaceLease";

describe("editorRuntimeWorkspaceLease", () => {
  it("releases a workspace only after its final host owner", () => {
    const monaco = {} as typeof Monaco;
    const first = Symbol("first");
    const replacement = Symbol("replacement");

    retainEditorRuntimeWorkspace(monaco, "/workspace", first);
    retainEditorRuntimeWorkspace(monaco, "/workspace/", replacement);

    expect(releaseEditorRuntimeWorkspace(monaco, "/workspace", first)).toBe(false);
    expect(
      releaseEditorRuntimeWorkspace(monaco, "/workspace", replacement),
    ).toBe(true);
  });

  it("does not release a lease through an unknown owner", () => {
    const monaco = {} as typeof Monaco;
    const owner = Symbol("owner");

    retainEditorRuntimeWorkspace(monaco, "/workspace", owner);
    expect(
      releaseEditorRuntimeWorkspace(monaco, "/workspace", Symbol("foreign")),
    ).toBe(false);
    expect(releaseEditorRuntimeWorkspace(monaco, "/workspace", owner)).toBe(true);
  });
});
