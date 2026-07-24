import { describe, expect, it } from "vitest";
import { editorSurfaceCommandIds } from "../domain/editorSurfaceCommand";
import { editorActionForSurfaceCommand } from "./editorSurfaceCommandAction";

describe("editorActionForSurfaceCommand", () => {
  it("maps Refactor to Monaco's official built-in action", () => {
    expect(editorActionForSurfaceCommand("editor.action.refactor")).toBe("editor.action.refactor");
  });

  it("handles every bounded surface command", () => {
    expect(editorSurfaceCommandIds.map(editorActionForSurfaceCommand)).toHaveLength(
      editorSurfaceCommandIds.length,
    );
  });
});
