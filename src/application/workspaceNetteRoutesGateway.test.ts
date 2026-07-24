import { describe, expect, it, vi } from "vitest";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import { WorkspaceNetteRoutesGateway } from "./workspaceNetteRoutesGateway";

const ROOT = "/workspace";

function file(path: string): FileEntry {
  return { kind: "file", name: path.split("/").pop() ?? path, path };
}

function directory(path: string): FileEntry {
  return { kind: "directory", name: path.split("/").pop() ?? path, path };
}

function files(
  directories: Readonly<Record<string, readonly FileEntry[]>>,
  sources: Readonly<Record<string, string>>,
): {
  readDirectoryBounded: NonNullable<WorkspaceFileGateway["readDirectoryBounded"]>;
  readTextFileBounded: NonNullable<WorkspaceFileGateway["readTextFileBounded"]>;
} {
  return {
    readDirectoryBounded: vi.fn(async (path: string, maxEntries: number) => {
      const entries = directories[path];
      if (!entries) throw new Error(`Missing directory: ${path}`);
      return { entries: entries.slice(0, maxEntries), truncated: entries.length > maxEntries };
    }),
    readTextFileBounded: vi.fn(async (path: string, maxBytes: number) => {
      const content = sources[path];
      if (content === undefined) throw new Error(`Missing file: ${path}`);
      return new TextEncoder().encode(content).byteLength > maxBytes
        ? { status: "tooLarge" as const }
        : { status: "ok" as const, content };
    }),
  };
}

describe("WorkspaceNetteRoutesGateway", () => {
  it("reuses bounded Nette route source discovery", async () => {
    const routerDirectory = `${ROOT}/app/Router`;
    const routerPath = `${routerDirectory}/RouterFactory.php`;
    const bootstrapPath = `${ROOT}/app/Bootstrap.php`;
    const workspaceFiles = files(
      {
        [`${ROOT}/app`]: [directory(routerDirectory), file(bootstrapPath)],
        [routerDirectory]: [file(routerPath)],
      },
      {
        [routerPath]: "<?php $r[] = new Route('/orders', 'Order:list');",
        [bootstrapPath]: "<?php $r[] = new Route('/health', 'Health:default');",
      },
    );
    const result = await new WorkspaceNetteRoutesGateway(
      workspaceFiles,
    ).inspectNetteWorkspaceRoutes(ROOT, []);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        routes: [
          expect.objectContaining({
            mask: "/health",
            target: { raw: "Health:default", presenter: "Health", action: "default" },
          }),
          expect.objectContaining({
            mask: "/orders",
            target: { raw: "Order:list", presenter: "Order", action: "list" },
          }),
        ],
        truncated: false,
      }),
    );
    expect(workspaceFiles.readDirectoryBounded).toHaveBeenCalledWith(
      `${ROOT}/app`,
      expect.any(Number),
    );
  });

  it("uses a dirty router overlay", async () => {
    const path = `${ROOT}/app/Router.php`;
    const workspaceFiles = files(
      { [`${ROOT}/app`]: [file(path)] },
      { [path]: "<?php new Route('/disk', 'Disk:default');" },
    );
    const result = await new WorkspaceNetteRoutesGateway(
      workspaceFiles,
    ).inspectNetteWorkspaceRoutes(ROOT, [
      {
        path,
        source: "<?php new Route('/dirty', 'Dirty:show');",
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        routes: [expect.objectContaining({ mask: "/dirty" })],
      }),
    );
  });

  it("rejects traversal entries before native text reads", async () => {
    const escaped = `${ROOT}/app/../../outside/Router.php`;
    const workspaceFiles = files(
      { [`${ROOT}/app`]: [file(escaped)] },
      { [escaped]: "<?php new Route('/bad', 'Bad:default');" },
    );
    const result = await new WorkspaceNetteRoutesGateway(
      workspaceFiles,
    ).inspectNetteWorkspaceRoutes(ROOT, []);

    expect(result).toEqual({
      status: "error",
      message: "Could not read the complete Nette route source set.",
    });
    expect(workspaceFiles.readTextFileBounded).not.toHaveBeenCalled();
  });

  it("fails closed on native directory or source truncation", async () => {
    const directoryFiles = files({ [`${ROOT}/app`]: [] }, {});
    vi.mocked(directoryFiles.readDirectoryBounded).mockResolvedValueOnce({
      entries: [],
      truncated: true,
    });
    await expect(
      new WorkspaceNetteRoutesGateway(directoryFiles).inspectNetteWorkspaceRoutes(ROOT, []),
    ).resolves.toEqual({
      status: "error",
      message: "Nette route inspection exceeded its safety limits.",
    });

    const path = `${ROOT}/app/Router.php`;
    const sourceFiles = files({ [`${ROOT}/app`]: [file(path)] }, {});
    vi.mocked(sourceFiles.readTextFileBounded).mockResolvedValueOnce({ status: "tooLarge" });
    await expect(
      new WorkspaceNetteRoutesGateway(sourceFiles).inspectNetteWorkspaceRoutes(ROOT, []),
    ).resolves.toEqual({
      status: "error",
      message: "Nette route inspection exceeded its safety limits.",
    });
  });

  it("fails closed when a native directory or source read fails", async () => {
    const directoryFiles = files({ [`${ROOT}/app`]: [] }, {});
    vi.mocked(directoryFiles.readDirectoryBounded).mockRejectedValueOnce(
      new Error("directory unavailable"),
    );
    await expect(
      new WorkspaceNetteRoutesGateway(directoryFiles).inspectNetteWorkspaceRoutes(ROOT, []),
    ).resolves.toEqual({
      status: "error",
      message: "Could not read the complete Nette route source set.",
    });

    const path = `${ROOT}/app/Router.php`;
    const sourceFiles = files({ [`${ROOT}/app`]: [file(path)] }, {});
    vi.mocked(sourceFiles.readTextFileBounded).mockRejectedValueOnce(
      new Error("source unavailable"),
    );
    await expect(
      new WorkspaceNetteRoutesGateway(sourceFiles).inspectNetteWorkspaceRoutes(ROOT, []),
    ).resolves.toEqual({
      status: "error",
      message: "Could not read the complete Nette route source set.",
    });
  });

  it("returns unavailable without native reads", async () => {
    const workspaceFiles = files({}, {});
    await expect(
      new WorkspaceNetteRoutesGateway(workspaceFiles).inspectNetteWorkspaceRoutes("", []),
    ).resolves.toEqual({ status: "unavailable", message: "No workspace is open." });
    expect(workspaceFiles.readDirectoryBounded).not.toHaveBeenCalled();
  });
});
