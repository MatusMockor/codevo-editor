import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceIdentityDescriptor } from "./tauriWorkspaceIdentityGateway";
import { TauriWorkspaceGateway } from "./tauriWorkspaceGateway";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const descriptor: WorkspaceIdentityDescriptor = {
  workspaceId: "ws-1",
  selectedPath: "/selected/project",
  canonicalRoot: "/real/project",
  caseSensitive: true,
  unicodeNormalizationPolicy: "preserved",
  policy: { caseSensitive: true, unicodeNormalization: "none" },
};

describe("TauriWorkspaceGateway trusted file operations", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("keeps descriptorless listing compatible but rejects bounded reads before invoke", async () => {
    invoke.mockResolvedValue([]);
    const gateway = new TauriWorkspaceGateway({
      descriptorForPath: () => null,
    });

    await expect(gateway.readDirectory("/legacy/dir")).resolves.toEqual([]);
    expect(() => gateway.readDirectoryBounded("/legacy/dir", 10)).toThrow("Reopen it explicitly");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("read_directory", {
      path: "/legacy/dir",
    });
  });

  it("routes owner-scoped creation through the captured workspace instead of a nested match", async () => {
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
    invoke.mockResolvedValue({ status: "success" });

    await gateway.createDirectoryForWorkspace(
      descriptor.workspaceId,
      "/selected/project/packages/nested/.vscode",
    );

    expect(invoke).toHaveBeenCalledWith("workspace_create_directory", {
      workspaceId: descriptor.workspaceId,
      relativePath: "packages/nested/.vscode",
    });
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
        "/selected/project/.codevo/settings.json",
        "{}\n",
      ),
    ).resolves.toEqual({ status: "success", revision: revision() });

    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_create_directory", {
      workspaceId: "ws-1",
      relativePath: ".codevo",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_create_text_file_with_content", {
      workspaceId: "ws-1",
      relativePath: ".codevo/settings.json",
      content: "{}\n",
    });
  });

  it("rejects owner-scoped creation when the captured workspace no longer owns the path", () => {
    const gateway = new TauriWorkspaceGateway({
      descriptorForPath: () => descriptor,
      matchForPath: () => null,
    });

    expect(() =>
      gateway.createTextFileWithContentForWorkspace(
        "ws-retired",
        "/selected/project/.vscode/tasks.json",
        "{}\n",
      ),
    ).toThrow("does not belong to the captured workspace");
    expect(() =>
      gateway.createDirectoryForWorkspace("ws-retired", "/selected/project/.vscode"),
    ).toThrow("does not belong to the captured workspace");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("passes recursive folder paths to Rust and rejects typed partial mutations", async () => {
    invoke
      .mockResolvedValueOnce({ status: "success" })
      .mockResolvedValueOnce({ status: "partial", message: "directory sync failed" });
    const gateway = trustedGateway();

    await gateway.createDirectoryForWorkspace("ws-1", "/selected/project/a/b/c");
    await expect(
      gateway.createDirectoryForWorkspace("ws-1", "/selected/project/a/d"),
    ).rejects.toThrow("directory sync failed");

    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_create_directory", {
      workspaceId: "ws-1",
      relativePath: "a/b/c",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_create_directory", {
      workspaceId: "ws-1",
      relativePath: "a/d",
    });
  });

  it("routes trusted listing and file search without raw absolute paths", async () => {
    invoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
      requestGeneration: "gateway-file-search",
      results: [],
      truncated: false,
    });
    const gateway = trustedGateway();

    await gateway.readDirectory("/selected/project/src");
    await gateway.searchFiles("/selected/project", "App", 10);
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
  });

  it("uses the strict bounded directory contract and preserves the selected alias", async () => {
    invoke.mockResolvedValue({
      entries: [
        { name: "App.php", relativePath: "App.php", kind: "file", ignored: false },
        { name: "environment.ts", relativePath: "environment.ts", kind: "file", ignored: true },
      ],
      truncated: true,
    });
    await expect(
      trustedGateway().readDirectoryBounded("/selected/project/src", 20_000),
    ).resolves.toEqual({
      entries: [
        { name: "App.php", path: "/selected/project/src/App.php", kind: "file", ignored: false },
        {
          name: "environment.ts",
          path: "/selected/project/src/environment.ts",
          kind: "file",
          ignored: true,
        },
      ],
      truncated: true,
    });
    expect(invoke).toHaveBeenCalledWith("workspace_read_directory_bounded", {
      workspaceId: "ws-1",
      relativePath: "src",
      maxEntries: 20_000,
    });
  });

  it("preserves the selected alias identity in returned explorer and file-search paths", async () => {
    invoke
      .mockResolvedValueOnce([{ name: "App.ts", relativePath: "App.ts", kind: "file" }])
      .mockResolvedValueOnce({
        requestGeneration: "gateway-file-search",
        results: [{ name: "App.ts", relativePath: "App.ts" }],
        truncated: false,
      });
    const gateway = trustedGateway();
    await expect(gateway.readDirectory("/selected/project/src")).resolves.toEqual([
      { name: "App.ts", path: "/selected/project/src/App.ts", kind: "file" },
    ]);
    await expect(gateway.searchFiles("/selected/project/src", "App", 10)).resolves.toEqual([
      { name: "App.ts", path: "/selected/project/src/App.ts", relativePath: "App.ts" },
    ]);
  });

  it("surfaces descriptor walk truncation from a closed file-search payload", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "file-request-1",
      results: [{ name: "App.ts", relativePath: "App.ts" }],
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

  it("keeps an ordinary empty descriptor search distinct from truncated traversal", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "file-empty",
      results: [],
      truncated: false,
    });

    await expect(
      trustedGateway().searchFilesWithMetadata("/selected/project", "missing", 10, "file-empty"),
    ).resolves.toEqual({
      requestGeneration: "file-empty",
      results: [],
      truncated: false,
    });
  });

  it("rejects malformed descriptor truncation metadata fail-closed", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "file-malformed",
      results: [{ name: "App.ts", relativePath: "App.ts" }],
      truncated: "yes",
    });

    await expect(
      trustedGateway().searchFilesWithMetadata("/selected/project", "App", 10, "file-malformed"),
    ).rejects.toThrow("invalid payload");
  });

  it.each([
    ["parent traversal", "outside.ts", "../outside.ts"],
    ["absolute path", "outside.ts", "/outside.ts"],
    ["backslash", "outside.ts", "dir\\outside.ts"],
    ["control character", "outside.ts", "dir/\u0000outside.ts"],
    ["dot segment", "outside.ts", "dir/./outside.ts"],
    ["inconsistent basename", "other.ts", "dir/outside.ts"],
  ])("rejects a hostile descriptor result path (%s)", async (_label, name, relativePath) => {
    invoke.mockResolvedValue({
      requestGeneration: "file-hostile",
      results: [{ name, relativePath }],
      truncated: false,
    });

    await expect(
      trustedGateway().searchFilesWithMetadata("/selected/project", "outside", 10, "file-hostile"),
    ).rejects.toThrow(/invalid result path|inconsistent result name/);
  });

  it("rejects descriptor result counts beyond the requested bounded limit", async () => {
    invoke.mockResolvedValue({
      requestGeneration: "file-overflow",
      results: Array.from({ length: 11 }, (_, index) => ({
        name: `file-${index}.ts`,
        relativePath: `src/file-${index}.ts`,
      })),
      truncated: true,
    });

    await expect(
      trustedGateway().searchFilesWithMetadata("/selected/project", "file", 10, "file-overflow"),
    ).rejects.toThrow("too many results");
  });

  it("rejects descriptor file-search payloads beyond the Rust response-byte cap", async () => {
    const prefix = Array.from({ length: 15 }, () => "p".repeat(250)).join("/");
    invoke.mockResolvedValue({
      requestGeneration: "file-too-large",
      results: Array.from({ length: 500 }, (_, index) => {
        const name = `${index.toString().padStart(3, "0")}-${"n".repeat(240)}.ts`;
        return { name, relativePath: `${prefix}/${name}` };
      }),
      truncated: true,
    });

    await expect(
      trustedGateway().searchFilesWithMetadata("/selected/project", "file", 500, "file-too-large"),
    ).rejects.toThrow("byte limit");
  });

  it("rejects request generations that Rust would reject before invoking IPC", async () => {
    await expect(
      trustedGateway().searchFilesWithMetadata("/selected/project", "App", 10, "bad generation"),
    ).rejects.toThrow("request generation is invalid");
    expect(invoke).not.toHaveBeenCalled();
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

  it("rejects stale resolver results before invoking", () => {
    const staleGateway = new TauriWorkspaceGateway({
      descriptorForPath: () => descriptor,
    });
    expect(() => staleGateway.readDirectoryBounded("/outside/project/dir", 10)).toThrow(
      "outside the active trusted workspace",
    );
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
