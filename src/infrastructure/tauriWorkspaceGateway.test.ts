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
    invoke.mockResolvedValue({
      status: "success",
      appliedFileOperations: 1,
      appliedTextFiles: 1,
      appliedCount: 2,
    });
    const edit = {
      changes: {
        "file:///selected/project/src/App.ts": [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: "next",
          },
        ],
      },
      fileOperations: [
        {
          kind: "rename" as const,
          oldUri: "file:///selected/project/src/Old.ts",
          newUri: "file:///selected/project/src/New.ts",
        },
      ],
    };

    await expect(
      trustedGateway().applyWorkspaceEdit("/selected/project", edit, [
        "/selected/project/src/Open.ts",
      ]),
    ).resolves.toBe(2);
    expect(invoke).toHaveBeenCalledWith("workspace_apply_workspace_edit", {
      workspaceId: "ws-1",
      edit: {
        changes: { "src/App.ts": edit.changes["file:///selected/project/src/App.ts"] },
        fileOperations: [{ kind: "rename", oldUri: "src/Old.ts", newUri: "src/New.ts" }],
      },
      skippedPaths: ["src/Open.ts"],
    });
  });

  it("applies and rolls back a trusted transactional workspace edit", async () => {
    const edit = {
      changes: {
        "file:///selected/project/src/App.ts": [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: "next",
          },
        ],
      },
    };
    const rollbackEdit = {
      changes: {
        "src/App.ts": [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 4 },
            },
            newText: "old",
          },
        ],
      },
      documentVersions: {},
      fileOperations: [],
    };
    invoke
      .mockResolvedValueOnce({
        appliedCount: 1,
        rollbackEdit,
        rollbackExpectedStates: { "src/App.ts": "abc" },
        rollbackFileModes: { "src/App.ts": 0o644 },
      })
      .mockResolvedValueOnce({
        appliedCount: 1,
        rollbackEdit: { changes: {} },
        rollbackExpectedStates: {},
        rollbackFileModes: {},
      });

    const transaction = await trustedGateway().applyWorkspaceEditTransaction(
      "/selected/project",
      edit,
      ["/selected/project/src/Open.ts"],
      { "/selected/project/src/App.ts": "123" },
    );
    expect(transaction.appliedCount).toBe(1);
    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_apply_workspace_edit_transaction", {
      workspaceId: "ws-1",
      edit: {
        changes: {
          "src/App.ts": edit.changes["file:///selected/project/src/App.ts"],
        },
      },
      skippedPaths: ["src/Open.ts"],
      expectedStates: { "src/App.ts": "123" },
      fileModes: {},
    });

    await transaction.rollback();
    await transaction.rollback();
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_apply_workspace_edit_transaction", {
      workspaceId: "ws-1",
      edit: rollbackEdit,
      skippedPaths: [],
      expectedStates: { "src/App.ts": "abc" },
      fileModes: { "src/App.ts": 0o644 },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("keeps descriptorless workspace edits on the legacy command", async () => {
    invoke.mockResolvedValue(3);
    const gateway = new TauriWorkspaceGateway({ descriptorForPath: () => null });
    const edit = { changes: {} };

    await expect(gateway.applyWorkspaceEdit("/legacy", edit, [])).resolves.toBe(3);
    expect(invoke).toHaveBeenCalledWith("apply_workspace_edit", {
      rootPath: "/legacy",
      edit,
      skippedPaths: [],
    });
  });

  it("treats an available path matcher miss as authoritative without legacy re-resolution", async () => {
    const matchForPath = vi.fn(() => null);
    const descriptorForPath = vi.fn(() => descriptor);
    invoke.mockResolvedValue("legacy content");
    const gateway = new TauriWorkspaceGateway({ descriptorForPath, matchForPath });

    await expect(gateway.readTextFile("/outside/file.ts")).resolves.toBe("legacy content");

    expect(matchForPath).toHaveBeenCalledTimes(1);
    expect(matchForPath).toHaveBeenCalledWith("/outside/file.ts", undefined);
    expect(descriptorForPath).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("read_text_file", { path: "/outside/file.ts" });
  });

  it("drops skipped open documents outside the trusted workspace", async () => {
    invoke.mockResolvedValue({
      status: "success",
      appliedFileOperations: 0,
      appliedTextFiles: 1,
      appliedCount: 1,
    });

    await expect(
      trustedGateway().applyWorkspaceEdit(
        "/selected/project",
        { changes: { "file:///selected/project/src/App.ts": [] } },
        ["/selected/project/src/Open.ts", "/external/Definition.ts"],
      ),
    ).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith(
      "workspace_apply_workspace_edit",
      expect.objectContaining({ skippedPaths: ["src/Open.ts"] }),
    );
  });

  it.each(["untitled:Scratch", "file:///selected/project/src/bad%value.ts"])(
    "skips an unresolvable %s URI while applying valid entries",
    async (invalidUri) => {
      invoke.mockResolvedValue({
        status: "success",
        appliedFileOperations: 0,
        appliedTextFiles: 1,
        appliedCount: 1,
      });
      const validEdits = [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: "valid",
        },
      ];

      await expect(
        trustedGateway().applyWorkspaceEdit(
          "/selected/project",
          {
            changes: {
              [invalidUri]: [],
              "file:///selected/project/src/App.ts": validEdits,
            },
            documentVersions: { [invalidUri]: 1, "file:///selected/project/src/App.ts": 2 },
            fileOperations: [
              { kind: "delete", uri: invalidUri },
              { kind: "create", uri: "file:///selected/project/src/New.ts" },
            ],
          },
          [],
        ),
      ).resolves.toBe(1);
      expect(invoke).toHaveBeenCalledWith("workspace_apply_workspace_edit", {
        workspaceId: "ws-1",
        edit: {
          changes: { "src/App.ts": validEdits },
          documentVersions: { "src/App.ts": 2 },
          fileOperations: [{ kind: "create", uri: "src/New.ts" }],
        },
        skippedPaths: [],
      });
    },
  );

  it.each(["partial", "conflict", "error"])(
    "rejects a typed %s workspace edit outcome",
    async (status) => {
      invoke.mockResolvedValue({
        status,
        appliedFileOperations: 1,
        appliedTextFiles: 0,
        appliedCount: 1,
        failedPath: "src/App.ts",
        message: "file changed",
      });

      await expect(
        trustedGateway().applyWorkspaceEdit("/selected/project", { changes: {} }, []),
      ).rejects.toThrow("src/App.ts: file changed");
    },
  );

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
    expect(() => gateway.writeTextFile("/legacy/file.ts", "next")).toThrow("Reopen it explicitly");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("read_text_file", {
      path: "/legacy/file.ts",
    });
  });

  it("uses typed save results and never sends an absolute path", async () => {
    invoke.mockResolvedValueOnce({ status: "conflict", message: "changed" });

    await expect(
      trustedGateway().writeTextFile("/selected/project/src/App.ts", "editor", revision()),
    ).resolves.toEqual({ status: "conflict", message: "changed" });
    expect(invoke).toHaveBeenCalledWith("workspace_save_text_file", {
      workspaceId: "ws-1",
      relativePath: "src/App.ts",
      content: "editor",
      expectedRevision: revision(),
    });
  });

  it("routes an owner-scoped save through the captured workspace instead of a nested match", async () => {
    const nestedDescriptor = {
      ...descriptor,
      workspaceId: "ws-nested",
      selectedPath: "/selected/project/packages/nested",
      canonicalRoot: "/real/project/packages/nested",
    };
    const gateway = new TauriWorkspaceGateway({
      descriptorForPath: () => nestedDescriptor,
      matchForPath: (path, workspaceId) => {
        if (workspaceId !== descriptor.workspaceId) {
          return null;
        }

        return {
          descriptor,
          matchedRoot: descriptor.selectedPath,
          relativePath: path.slice(`${descriptor.selectedPath}/`.length),
        };
      },
    });
    invoke.mockResolvedValue({ status: "success", revision: revision() });

    await gateway.writeTextFileForWorkspace(
      descriptor.workspaceId,
      "/selected/project/packages/nested/src/App.php",
      "<?php",
      revision(),
    );

    expect(invoke).toHaveBeenCalledWith("workspace_save_text_file", {
      workspaceId: descriptor.workspaceId,
      relativePath: "packages/nested/src/App.php",
      content: "<?php",
      expectedRevision: revision(),
    });
  });

  it("writes an owner-relative path directly without consulting current workspace descriptors", async () => {
    const descriptorForPath = vi.fn(() => {
      throw new Error("owner-relative writes must not resolve current descriptors");
    });
    const matchForPath = vi.fn(() => {
      throw new Error("owner-relative writes must not resolve current matches");
    });
    const gateway = new TauriWorkspaceGateway({ descriptorForPath, matchForPath });
    invoke.mockResolvedValue({ status: "success", revision: revision() });

    await expect(
      gateway.writeTextFileForWorkspaceRelativePath(
        "opaque-workspace-owner",
        "packages/app/src/main.ts",
        "export {};\n",
        revision(),
      ),
    ).resolves.toEqual({ status: "success", revision: revision() });

    expect(descriptorForPath).not.toHaveBeenCalled();
    expect(matchForPath).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("workspace_save_text_file", {
      workspaceId: "opaque-workspace-owner",
      relativePath: "packages/app/src/main.ts",
      content: "export {};\n",
      expectedRevision: revision(),
    });
  });

  it.each([
    "",
    ".",
    "..",
    "/src/App.ts",
    "C:/src/App.ts",
    "C:src/App.ts",
    "\\\\server\\share\\App.ts",
    "src\\App.ts",
    "src//App.ts",
    "src/./App.ts",
    "src/../App.ts",
    "src/App.ts/",
    "src/\nApp.ts",
    "src/\u007fApp.ts",
    "src/\u0085App.ts",
    `src/${"a".repeat(4_093)}`,
  ])("rejects invalid owner-relative write path %j before invoking IPC", (relativePath) => {
    const gateway = new TauriWorkspaceGateway({
      descriptorForPath: () => {
        throw new Error("must not resolve");
      },
    });

    expect(() =>
      gateway.writeTextFileForWorkspaceRelativePath(
        "opaque-workspace-owner",
        relativePath,
        "content",
        revision(),
      ),
    ).toThrow("normalized descendant path");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts the exact owner-relative UTF-8 byte boundary without path re-resolution", async () => {
    const relativePath = `a/${"é".repeat(2_047)}`;
    const descriptorForPath = vi.fn(() => descriptor);
    invoke.mockResolvedValue({ status: "success", revision: revision() });

    await new TauriWorkspaceGateway({
      descriptorForPath,
    }).writeTextFileForWorkspaceRelativePath("ws-captured", relativePath, "content", revision());

    expect(new TextEncoder().encode(relativePath)).toHaveLength(4_096);
    expect(descriptorForPath).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "workspace_save_text_file",
      expect.objectContaining({
        workspaceId: "ws-captured",
        relativePath,
      }),
    );
  });

  it("routes owner-scoped directory and atomic content creation with relative paths", async () => {
    invoke
      .mockResolvedValueOnce({ status: "success" })
      .mockResolvedValueOnce({ status: "success", revision: revision() });
    const gateway = trustedGateway();

    await gateway.createDirectoryForWorkspace("ws-1", "/selected/project/.codevo");
    await expect(
      gateway.createTextFileWithContentForWorkspace(
        "ws-1",
        "/selected/project/.codevo/launch.json",
        "{}\n",
      ),
    ).resolves.toEqual({ status: "success", revision: revision() });

    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_create_directory", {
      workspaceId: "ws-1",
      relativePath: ".codevo",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_create_text_file_with_content", {
      workspaceId: "ws-1",
      relativePath: ".codevo/launch.json",
      content: "{}\n",
    });
  });

  it("rejects an owner-scoped save when the captured workspace no longer owns the path", () => {
    const gateway = new TauriWorkspaceGateway({
      descriptorForPath: () => descriptor,
      matchForPath: () => null,
    });

    expect(() =>
      gateway.writeTextFileForWorkspace(
        "ws-retired",
        "/selected/project/src/App.php",
        "<?php",
        revision(),
      ),
    ).toThrow("does not belong to the captured workspace");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("maps descriptor-scoped replace payloads and presentation paths", async () => {
    invoke.mockResolvedValue({
      status: "partial",
      files: [{ relativePath: "src/a.ts", replacements: 1 }],
      totalReplacements: 1,
      conflicts: [{ relativePath: "src/b.ts", message: "changed" }],
      errors: [],
      message: "partial",
    });
    await expect(
      trustedGateway().replaceInPath(
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
      ),
    ).resolves.toMatchObject({
      status: "partial",
      files: [{ path: "/selected/project/src/a.ts" }],
      conflicts: [{ path: "/selected/project/src/b.ts" }],
    });
    expect(invoke).toHaveBeenCalledWith("workspace_replace_in_path", {
      workspaceId: "ws-1",
      relativePath: "src",
      query: "before",
      replacement: "after",
      options: {
        caseSensitive: false,
        wholeWord: false,
        isRegex: false,
        preserveCase: true,
        fileMask: "",
      },
    });
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
      gateway.replaceInPath(
        "/selected/project",
        "before",
        "after",
        undefined,
        "/selected/other/src",
      ),
    ).rejects.toThrow("Replace scope must belong to the selected workspace.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not let background reads alter an explicit save revision", async () => {
    const first = revision();
    const background = { ...revision(), contentHash: "99" };
    invoke
      .mockResolvedValueOnce({ content: "background", revision: background })
      .mockResolvedValueOnce({ status: "success", revision: first });
    const gateway = trustedGateway();

    await gateway.readTextFile("/selected/project/src/App.ts");
    await gateway.writeTextFile("/selected/project/src/App.ts", "editor", first);

    expect(invoke).toHaveBeenLastCalledWith("workspace_save_text_file", {
      workspaceId: "ws-1",
      relativePath: "src/App.ts",
      content: "editor",
      expectedRevision: first,
    });
  });

  it("preserves u64 revision fields as exact decimal strings", async () => {
    const exactRevision = {
      ...revision(),
      device: "9007199254740993",
      inode: "18436989904237926844",
      contentHash: "18446744073709551615",
    };
    invoke
      .mockResolvedValueOnce({ content: "disk", revision: exactRevision })
      .mockResolvedValueOnce({ status: "success", revision: exactRevision });
    const gateway = trustedGateway();

    const snapshot = await gateway.readTextFileSnapshot("/selected/project/src/App.ts");
    await gateway.writeTextFile(
      "/selected/project/src/App.ts",
      "editor",
      snapshot.revision ?? undefined,
    );

    expect(snapshot.revision).toEqual(exactRevision);
    expect(invoke).toHaveBeenLastCalledWith("workspace_save_text_file", {
      workspaceId: "ws-1",
      relativePath: "src/App.ts",
      content: "editor",
      expectedRevision: exactRevision,
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
    invoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        requestGeneration: "gateway-file-search",
        results: [],
        truncated: false,
      })
      .mockResolvedValueOnce({
        requestGeneration: "gateway-search-text",
        results: [],
        truncated: false,
      });
    const gateway = trustedGateway();

    await gateway.readDirectory("/selected/project/src");
    await gateway.searchFiles("/selected/project", "App", 10);
    await gateway.searchText("/selected/project", "App", 10);
    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_read_directory", {
      workspaceId: "ws-1",
      relativePath: "src",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_search_files", {
      workspaceId: "ws-1",
      relativePath: "",
      query: "App",
      limit: 10,
      requestGeneration: "gateway-file-search",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "workspace_search_text", {
      workspaceId: "ws-1",
      relativePath: "",
      query: "App",
      limit: 10,
      options: null,
      requestGeneration: "gateway-search-text",
    });
  });

  it("uses the strict bounded workspace read contract", async () => {
    invoke.mockResolvedValue({ status: "tooLarge" });
    await expect(
      trustedGateway().readTextFileBounded("/selected/project/.codevo/launch.json", 262_144),
    ).resolves.toEqual({ status: "tooLarge" });
    expect(invoke).toHaveBeenCalledWith("workspace_read_text_file_bounded", {
      workspaceId: "ws-1",
      relativePath: ".codevo/launch.json",
      maxBytes: 262_144,
    });
  });

  it("uses the strict bounded directory contract and preserves the selected alias", async () => {
    invoke.mockResolvedValue({
      entries: [{ name: "App.php", relativePath: "App.php", kind: "file" }],
      truncated: true,
    });
    await expect(
      trustedGateway().readDirectoryBounded("/selected/project/src", 20_000),
    ).resolves.toEqual({
      entries: [{ name: "App.php", path: "/selected/project/src/App.php", kind: "file" }],
      truncated: true,
    });
    expect(invoke).toHaveBeenCalledWith("workspace_read_directory_bounded", {
      workspaceId: "ws-1",
      relativePath: "src",
      maxEntries: 20_000,
    });
  });

  it("preserves the selected alias identity in returned explorer and search paths", async () => {
    invoke
      .mockResolvedValueOnce([{ name: "App.ts", relativePath: "App.ts", kind: "file" }])
      .mockResolvedValueOnce({
        requestGeneration: "gateway-file-search",
        results: [{ name: "App.ts", relativePath: "App.ts", truncated: false }],
        truncated: false,
      })
      .mockResolvedValueOnce({
        requestGeneration: "gateway-search-text",
        results: [
          {
            relativePath: "App.ts",
            lineNumber: 1,
            column: 1,
            lineText: "App",
            matchStart: 0,
            matchEnd: 3,
            previewTruncated: false,
            matchTruncated: false,
          },
        ],
        truncated: false,
      });
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

  it("surfaces trusted text-search truncation from a closed response", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "request-7",
      results: [
        {
          relativePath: "App.ts",
          lineNumber: 1,
          column: 1,
          lineText: "App",
          matchStart: 0,
          matchEnd: 3,
          previewTruncated: true,
          matchTruncated: false,
        },
      ],
      truncated: true,
    });

    await expect(
      trustedGateway().searchTextWithMetadata(
        "/selected/project",
        "App",
        10,
        undefined,
        "request-7",
      ),
    ).resolves.toEqual({
      requestGeneration: "request-7",
      results: [
        {
          path: "/selected/project/App.ts",
          relativePath: "App.ts",
          lineNumber: 1,
          column: 1,
          lineText: "App",
          matchStart: 0,
          matchEnd: 3,
          previewTruncated: true,
          matchTruncated: false,
        },
      ],
      truncated: true,
    });
  });

  it("rejects unknown fields in trusted text-search responses", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "request-8",
      results: [],
      truncated: false,
      unexpected: true,
    });

    await expect(
      trustedGateway().searchTextWithMetadata(
        "/selected/project",
        "App",
        10,
        undefined,
        "request-8",
      ),
    ).rejects.toThrow("invalid payload");
  });

  it("rejects a trusted text-search response from another request generation", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "request-older",
      results: [],
      truncated: false,
    });

    await expect(
      trustedGateway().searchTextWithMetadata(
        "/selected/project",
        "App",
        10,
        undefined,
        "request-current",
      ),
    ).rejects.toThrow("mismatched request generation");
  });

  it("permits clipped text spans only under closed match-truncation semantics", async () => {
    const result = {
      relativePath: "App.ts",
      lineNumber: 1,
      column: 1,
      lineText: "App",
      matchStart: 0,
      matchEnd: 99,
      previewTruncated: true,
      matchTruncated: false,
    };
    invoke
      .mockResolvedValueOnce({
        requestGeneration: "text-span-1",
        results: [result],
        truncated: false,
      })
      .mockResolvedValueOnce({
        requestGeneration: "text-span-2",
        results: [{ ...result, matchTruncated: true, previewTruncated: false }],
        truncated: false,
      })
      .mockResolvedValueOnce({
        requestGeneration: "text-span-3",
        results: [{ ...result, matchTruncated: true }],
        truncated: false,
      });
    const gateway = trustedGateway();

    await expect(
      gateway.searchTextWithMetadata("/selected/project", "App", 10, undefined, "text-span-1"),
    ).rejects.toThrow("invalid result");
    await expect(
      gateway.searchTextWithMetadata("/selected/project", "App", 10, undefined, "text-span-2"),
    ).rejects.toThrow("invalid result");
    await expect(
      gateway.searchTextWithMetadata("/selected/project", "App", 10, undefined, "text-span-3"),
    ).resolves.toEqual(
      expect.objectContaining({
        results: [expect.objectContaining({ matchEnd: 99, matchTruncated: true })],
      }),
    );
  });

  it("keeps the legacy raw-root text-search array compatible", async () => {
    invoke.mockResolvedValue([
      {
        path: "/legacy/App.ts",
        relativePath: "App.ts",
        lineNumber: 1,
        column: 1,
        lineText: "App",
        matchStart: 0,
        matchEnd: 3,
      },
    ]);
    const gateway = new TauriWorkspaceGateway({ descriptorForPath: () => null });

    await expect(
      gateway.searchTextWithMetadata("/legacy", "App", 10, undefined, "legacy-9"),
    ).resolves.toEqual({
      requestGeneration: "legacy-9",
      results: [
        {
          path: "/legacy/App.ts",
          relativePath: "App.ts",
          lineNumber: 1,
          column: 1,
          lineText: "App",
          matchStart: 0,
          matchEnd: 3,
        },
      ],
      truncated: false,
    });
  });

  it("surfaces descriptor walk truncation from a closed file-search payload", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "file-request-1",
      results: [{ name: "App.ts", relativePath: "App.ts", truncated: true }],
      truncated: true,
    });

    await expect(
      trustedGateway().searchFilesWithMetadata("/selected/project", "App", 10, "file-request-1"),
    ).resolves.toEqual({
      requestGeneration: "file-request-1",
      results: [{ name: "App.ts", path: "/selected/project/App.ts", relativePath: "App.ts" }],
      truncated: true,
    });
  });

  it("rejects unknown fields in the file-search payload", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "file-request-2",
      results: [
        {
          name: "App.ts",
          relativePath: "App.ts",
          truncated: false,
          unexpected: true,
        },
      ],
      truncated: false,
    });

    await expect(
      trustedGateway().searchFilesWithMetadata("/selected/project", "App", 10, "file-request-2"),
    ).rejects.toThrow("invalid result");
  });

  it("accepts exact-generation saturated file search and rejects a foreign generation", async () => {
    invoke
      .mockResolvedValueOnce({
        requestGeneration: "file-saturated",
        results: [],
        truncated: true,
      })
      .mockResolvedValueOnce({
        requestGeneration: "file-old",
        results: [],
        truncated: true,
      });
    const gateway = trustedGateway();

    await expect(
      gateway.searchFilesWithMetadata("/selected/project", "App", 10, "file-saturated"),
    ).resolves.toEqual({
      requestGeneration: "file-saturated",
      results: [],
      truncated: true,
    });
    await expect(
      gateway.searchFilesWithMetadata("/selected/project", "App", 10, "file-current"),
    ).rejects.toThrow("mismatched request generation");
  });

  it("keeps the legacy raw-root file-search array isolated", async () => {
    invoke.mockResolvedValue([
      {
        name: "App.ts",
        path: "/legacy/App.ts",
        relativePath: "App.ts",
        truncated: true,
      },
    ]);
    const gateway = new TauriWorkspaceGateway({ descriptorForPath: () => null });

    await expect(
      gateway.searchFilesWithMetadata("/legacy", "App", 10, "legacy-file-1"),
    ).resolves.toEqual({
      requestGeneration: "legacy-file-1",
      results: [{ name: "App.ts", path: "/legacy/App.ts", relativePath: "App.ts" }],
      truncated: true,
    });
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
      gateway.renamePath("/selected/project/file.ts", "/selected/other/file.ts"),
    ).rejects.toThrow("between trusted workspaces");
    expect(invoke).not.toHaveBeenCalled();
  });
});

function trustedGateway(): TauriWorkspaceGateway {
  return new TauriWorkspaceGateway({ descriptorForPath: () => descriptor });
}

function revision() {
  return {
    device: "1",
    inode: "2",
    size: 4,
    modifiedSeconds: 5,
    modifiedNanoseconds: 6,
    contentHash: "7",
  };
}
