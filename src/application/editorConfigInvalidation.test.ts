import { describe, expect, it, vi } from "vitest";
import {
  isEditorConfigPath,
  refreshEditorConfigAfterDocumentSave,
  refreshEditorConfigForFileChange,
  workspaceFileChangeTouchesEditorConfig,
} from "./editorConfigInvalidation";

describe("EditorConfig invalidation", () => {
  it("recognizes EditorConfig paths across separators and casing", () => {
    expect(isEditorConfigPath("/workspace/.editorconfig")).toBe(true);
    expect(isEditorConfigPath(String.raw`C:\workspace\.EditorConfig`)).toBe(true);
    expect(isEditorConfigPath("/workspace/editorconfig.json")).toBe(false);
  });

  it("refreshes for create, change, delete, rename and watcher rescans", () => {
    const event = (kind: "created" | "deleted" | "modified") => ({
      fileKind: "file" as const,
      kind,
      path: "/workspace/.editorconfig",
      relativePath: ".editorconfig",
      rootPath: "/workspace",
    });
    expect(workspaceFileChangeTouchesEditorConfig(event("created"))).toBe(true);
    expect(workspaceFileChangeTouchesEditorConfig(event("modified"))).toBe(true);
    expect(workspaceFileChangeTouchesEditorConfig(event("deleted"))).toBe(true);
    expect(
      workspaceFileChangeTouchesEditorConfig({
        ...event("modified"),
        kind: "renamed",
        path: "/workspace/config.txt",
        previousPath: "/workspace/.editorconfig",
      }),
    ).toBe(true);
    expect(
      workspaceFileChangeTouchesEditorConfig({
        ...event("modified"),
        kind: "rescanRequired",
        path: "/workspace",
      }),
    ).toBe(true);
    expect(
      workspaceFileChangeTouchesEditorConfig({
        ...event("modified"),
        path: "/workspace/src/file.ts",
      }),
    ).toBe(false);
  });

  it("routes watcher and successful-save invalidations to their captured root", () => {
    const refreshRoot = vi.fn();
    const event = {
      fileKind: "file" as const,
      kind: "modified" as const,
      path: "/workspace/.editorconfig",
      relativePath: ".editorconfig",
      rootPath: "/workspace",
    };

    expect(refreshEditorConfigForFileChange(event, refreshRoot)).toBe(true);
    expect(
      refreshEditorConfigAfterDocumentSave(
        "/workspace",
        "/workspace/.editorconfig",
        refreshRoot,
      ),
    ).toBe(true);
    expect(
      refreshEditorConfigAfterDocumentSave(
        "/workspace",
        "/workspace/src/file.ts",
        refreshRoot,
      ),
    ).toBe(false);
    expect(refreshRoot).toHaveBeenCalledTimes(2);
    expect(refreshRoot).toHaveBeenNthCalledWith(1, "/workspace");
    expect(refreshRoot).toHaveBeenNthCalledWith(2, "/workspace");
  });
});
