import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceIdentityDescriptor } from "./tauriWorkspaceIdentityGateway";
import { TauriWorkspaceGateway } from "./tauriWorkspaceGateway";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const descriptor: WorkspaceIdentityDescriptor = {
  workspaceId: "ws-1",
  selectedPath: "/selected/project",
  canonicalRoot: "/real/project",
  caseSensitive: true,
  unicodeNormalizationPolicy: "preserved",
  policy: { caseSensitive: true, unicodeNormalization: "none" },
};

describe("TauriWorkspaceGateway trusted file operations", () => {
  beforeEach(() => invoke.mockReset());

  it("routes trusted workspace edits through the descriptor command with relative paths", async () => {
    invoke.mockResolvedValue({ status: "success", appliedFileOperations: 1, appliedTextFiles: 1, appliedCount: 2 });
    const edit = {
      changes: {
        "file:///selected/project/src/App.ts": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "next" }],
      },
      fileOperations: [{ kind: "rename" as const, oldUri: "file:///selected/project/src/Old.ts", newUri: "file:///selected/project/src/New.ts" }],
    };

    await expect(trustedGateway().applyWorkspaceEdit("/selected/project", edit, ["/selected/project/src/Open.ts"])).resolves.toBe(2);
    expect(invoke).toHaveBeenCalledWith("workspace_apply_workspace_edit", {
      workspaceId: "ws-1",
      edit: {
        changes: { "src/App.ts": edit.changes["file:///selected/project/src/App.ts"] },
        fileOperations: [{ kind: "rename", oldUri: "src/Old.ts", newUri: "src/New.ts" }],
      },
      skippedPaths: ["src/Open.ts"],
    });
  });

  it("keeps descriptorless workspace edits on the legacy command", async () => {
    invoke.mockResolvedValue(3);
    const gateway = new TauriWorkspaceGateway({ descriptorForPath: () => null });
    const edit = { changes: {} };

    await expect(gateway.applyWorkspaceEdit("/legacy", edit, [])).resolves.toBe(3);
    expect(invoke).toHaveBeenCalledWith("apply_workspace_edit", { rootPath: "/legacy", edit, skippedPaths: [] });
  });

  it("drops skipped open documents outside the trusted workspace", async () => {
    invoke.mockResolvedValue({ status: "success", appliedFileOperations: 0, appliedTextFiles: 1, appliedCount: 1 });

    await expect(trustedGateway().applyWorkspaceEdit(
      "/selected/project",
      { changes: { "file:///selected/project/src/App.ts": [] } },
      ["/selected/project/src/Open.ts", "/external/Definition.ts"],
    )).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith("workspace_apply_workspace_edit", expect.objectContaining({ skippedPaths: ["src/Open.ts"] }));
  });

  it.each(["untitled:Scratch", "file:///selected/project/src/bad%value.ts"])("skips an unresolvable %s URI while applying valid entries", async (invalidUri) => {
    invoke.mockResolvedValue({ status: "success", appliedFileOperations: 0, appliedTextFiles: 1, appliedCount: 1 });
    const validEdits = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "valid" }];

    await expect(trustedGateway().applyWorkspaceEdit("/selected/project", {
      changes: {
        [invalidUri]: [],
        "file:///selected/project/src/App.ts": validEdits,
      },
      documentVersions: { [invalidUri]: 1, "file:///selected/project/src/App.ts": 2 },
      fileOperations: [
        { kind: "delete", uri: invalidUri },
        { kind: "create", uri: "file:///selected/project/src/New.ts" },
      ],
    }, [])).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith("workspace_apply_workspace_edit", {
      workspaceId: "ws-1",
      edit: {
        changes: { "src/App.ts": validEdits },
        documentVersions: { "src/App.ts": 2 },
        fileOperations: [{ kind: "create", uri: "src/New.ts" }],
      },
      skippedPaths: [],
    });
  });

  it.each(["partial", "conflict", "error"])("rejects a typed %s workspace edit outcome", async (status) => {
    invoke.mockResolvedValue({ status, appliedFileOperations: 1, appliedTextFiles: 0, appliedCount: 1, failedPath: "src/App.ts", message: "file changed" });

    await expect(trustedGateway().applyWorkspaceEdit("/selected/project", { changes: {} }, [])).rejects.toThrow("src/App.ts: file changed");
  });

  it("routes selected and canonical aliases through workspace-relative reads", async () => {
    invoke.mockResolvedValue({ content: "", revision: revision() });
    const gateway = trustedGateway();

    await gateway.readTextFile("/selected/project/src/App.ts");
    await gateway.readTextFile("/real/project/src/App.ts");

    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_read_text_file", {
      workspaceId: "ws-1",
      relativePath: "src/App.ts",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_read_text_file", {
      workspaceId: "ws-1",
      relativePath: "src/App.ts",
    });
  });

  it("reads image bytes only through a trusted workspace descriptor", async () => {
    invoke.mockResolvedValue({ base64: "iVBORw==", byteLength: 4 });

    await expect(
      trustedGateway().readImageFile("/selected/project/assets/logo.png"),
    ).resolves.toEqual({ base64: "iVBORw==", byteLength: 4 });
    expect(invoke).toHaveBeenCalledWith("workspace_read_image_file", {
      workspaceId: "ws-1",
      relativePath: "assets/logo.png",
    });

    const untrusted = new TauriWorkspaceGateway({ descriptorForPath: () => null });
    await expect(untrusted.readImageFile("/legacy/logo.png")).rejects.toThrow(
      "Reopen it explicitly",
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps descriptorless reads compatible but rejects writes before invoke", async () => {
    invoke.mockResolvedValue("legacy");
    const gateway = new TauriWorkspaceGateway({
      descriptorForPath: () => null,
    });

    await expect(gateway.readTextFile("/legacy/file.ts")).resolves.toBe("legacy");
    expect(() => gateway.writeTextFile("/legacy/file.ts", "next")).toThrow(
      "Reopen it explicitly",
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("read_text_file", {
      path: "/legacy/file.ts",
    });
  });

  it("uses typed save results and never sends an absolute path", async () => {
    invoke.mockResolvedValueOnce({ status: "conflict", message: "changed" });

    await expect(
      trustedGateway().writeTextFile(
        "/selected/project/src/App.ts",
        "editor",
        revision(),
      ),
    ).resolves.toEqual({ status: "conflict", message: "changed" });
    expect(invoke).toHaveBeenCalledWith("workspace_save_text_file", {
      workspaceId: "ws-1",
      relativePath: "src/App.ts",
      content: "editor",
      expectedRevision: revision(),
    });
  });

  it("maps descriptor-scoped replace payloads and presentation paths", async () => {
    invoke.mockResolvedValue({ status: "partial", files: [{ relativePath: "src/a.ts", replacements: 1 }], totalReplacements: 1, conflicts: [{ relativePath: "src/b.ts", message: "changed" }], errors: [], message: "partial" });
    await expect(trustedGateway().replaceInPath(
        "/selected/project",
        "before",
        "after",
        {
          caseSensitive: false,
          wholeWord: false,
          isRegex: false,
          preserveCase: true,
          fileMask: "",
        },
        "/selected/project/src",
      )).resolves.toMatchObject({ status: "partial", files: [{ path: "/selected/project/src/a.ts" }], conflicts: [{ path: "/selected/project/src/b.ts" }] });
    expect(invoke).toHaveBeenCalledWith("workspace_replace_in_path", { workspaceId: "ws-1", relativePath: "src", query: "before", replacement: "after", options: { caseSensitive: false, wholeWord: false, isRegex: false, preserveCase: true, fileMask: "" } });
  });

  it("rejects a replace scope from another trusted workspace", async () => {
    const second = {
      ...descriptor,
      workspaceId: "ws-2",
      selectedPath: "/selected/other",
      canonicalRoot: "/real/other",
    };
    const gateway = new TauriWorkspaceGateway({
      descriptorForPath: (path) => (path.includes("other") ? second : descriptor),
    });

    await expect(
      gateway.replaceInPath("/selected/project", "before", "after", undefined, "/selected/other/src"),
    ).rejects.toThrow("Replace scope must belong to the selected workspace.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not let background reads alter an explicit save revision", async () => {
    const first = revision();
    const background = { ...revision(), contentHash: 99 };
    invoke
      .mockResolvedValueOnce({ content: "background", revision: background })
      .mockResolvedValueOnce({ status: "success", revision: first });
    const gateway = trustedGateway();

    await gateway.readTextFile("/selected/project/src/App.ts");
    await gateway.writeTextFile(
      "/selected/project/src/App.ts",
      "editor",
      first,
    );

    expect(invoke).toHaveBeenLastCalledWith("workspace_save_text_file", {
      workspaceId: "ws-1",
      relativePath: "src/App.ts",
      content: "editor",
      expectedRevision: first,
    });
  });

  it("passes recursive folder paths to Rust and rejects typed partial mutations", async () => {
    invoke
      .mockResolvedValueOnce({ status: "success" })
      .mockResolvedValueOnce({ status: "partial", message: "directory sync failed" });
    const gateway = trustedGateway();

    await gateway.createDirectory("/selected/project/a/b/c");
    await expect(gateway.deletePath("/selected/project/a")).rejects.toThrow(
      "directory sync failed",
    );

    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_create_directory", {
      workspaceId: "ws-1",
      relativePath: "a/b/c",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_delete_path", {
      workspaceId: "ws-1",
      relativePath: "a",
    });
  });

  it("routes trusted listing and searches without raw absolute paths", async () => {
    invoke.mockResolvedValue([]);
    const gateway = trustedGateway();

    await gateway.readDirectory("/selected/project/src");
    await gateway.searchFiles("/selected/project", "App", 10);
    await gateway.searchText("/selected/project", "App", 10);
    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_read_directory", { workspaceId: "ws-1", relativePath: "src" });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_search_files", { workspaceId: "ws-1", relativePath: "", query: "App", limit: 10 });
    expect(invoke).toHaveBeenNthCalledWith(3, "workspace_search_text", { workspaceId: "ws-1", relativePath: "", query: "App", limit: 10, options: null });
  });

  it("preserves the selected alias identity in returned explorer and search paths", async () => {
    invoke
      .mockResolvedValueOnce([{ name: "App.ts", relativePath: "App.ts", kind: "file" }])
      .mockResolvedValueOnce([{ name: "App.ts", relativePath: "App.ts" }])
      .mockResolvedValueOnce([{ relativePath: "App.ts", lineNumber: 1, column: 1, lineText: "App" }]);
    const gateway = trustedGateway();
    await expect(gateway.readDirectory("/selected/project/src")).resolves.toEqual([
      { name: "App.ts", path: "/selected/project/src/App.ts", kind: "file" },
    ]);
    await expect(gateway.searchFiles("/selected/project/src", "App", 10)).resolves.toEqual([
      { name: "App.ts", path: "/selected/project/src/App.ts", relativePath: "App.ts" },
    ]);
    await expect(gateway.searchText("/selected/project/src", "App", 10)).resolves.toEqual([
      expect.objectContaining({ path: "/selected/project/src/App.ts", relativePath: "App.ts" }),
    ]);
  });

  it("rejects stale resolver results and cross-workspace renames", async () => {
    const staleGateway = new TauriWorkspaceGateway({
      descriptorForPath: () => descriptor,
    });
    expect(() => staleGateway.deletePath("/outside/project/file.ts")).toThrow(
      "outside the active trusted workspace",
    );

    const second = {
      ...descriptor,
      workspaceId: "ws-2",
      selectedPath: "/selected/other",
      canonicalRoot: "/real/other",
    };
    const gateway = new TauriWorkspaceGateway({
      descriptorForPath: (path) => (path.includes("other") ? second : descriptor),
    });
    await expect(
      gateway.renamePath(
        "/selected/project/file.ts",
        "/selected/other/file.ts",
      ),
    ).rejects.toThrow("between trusted workspaces");
    expect(invoke).not.toHaveBeenCalled();
  });
});

function trustedGateway(): TauriWorkspaceGateway {
  return new TauriWorkspaceGateway({ descriptorForPath: () => descriptor });
}

function revision() {
  return {
    device: 1,
    inode: 2,
    size: 4,
    modifiedSeconds: 5,
    modifiedNanoseconds: 6,
    contentHash: 7,
  };
}
