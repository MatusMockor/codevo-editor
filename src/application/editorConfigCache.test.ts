import { describe, expect, it } from "vitest";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  editorConfigCacheKey,
  invalidateEditorConfigCacheForRoot,
  type EditorConfigCache,
} from "./editorConfigCache";

describe("EditorConfig cache lifecycle", () => {
  it("removes plain and owner-specific entries for a disposed root", () => {
    const disposedOwner = createWorkspaceRuntimeOwner(
      "disposed-workspace",
      "/canonical/project",
    );
    const retainedOwner = createWorkspaceRuntimeOwner(
      "retained-workspace",
      "/other/project",
    );
    const disposedOwnerKey = editorConfigCacheKey(
      "/selected/project",
      disposedOwner,
    );
    const retainedOwnerKey = editorConfigCacheKey(
      retainedOwner.executionRoot,
      retainedOwner,
    );
    const cache: EditorConfigCache = {
      "/canonical/project": { "/canonical/project": null },
      [disposedOwnerKey]: { "/canonical/project": null },
      [retainedOwnerKey]: { "/other/project": null },
    };

    invalidateEditorConfigCacheForRoot(cache, "/canonical/project/");

    expect(cache).toEqual({
      [retainedOwnerKey]: { "/other/project": null },
    });
  });

  it("removes every owner generation so reopen starts with an empty cache", () => {
    const rootPath = "/project";
    const firstOwner = createWorkspaceRuntimeOwner("workspace", rootPath);
    const reopenedOwner = createWorkspaceRuntimeOwner("workspace", rootPath);
    const cache: EditorConfigCache = {
      [editorConfigCacheKey(rootPath, firstOwner)]: {
        [rootPath]: {
          directory: rootPath,
          parsed: { root: true, sections: [] },
        },
      },
    };

    invalidateEditorConfigCacheForRoot(cache, rootPath);

    expect(cache[editorConfigCacheKey(rootPath, reopenedOwner)]).toBeUndefined();
  });

  it("ignores unrelated and malformed cache keys", () => {
    const cache: EditorConfigCache = {
      "[\"incomplete\"]": { "/incomplete": null },
      "not-json": { "/plain": null },
    };

    invalidateEditorConfigCacheForRoot(cache, "/project");

    expect(Object.keys(cache)).toEqual(["[\"incomplete\"]", "not-json"]);
  });
});
