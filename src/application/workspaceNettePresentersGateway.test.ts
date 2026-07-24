import { describe, expect, it, vi } from "vitest";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import { WorkspaceNettePresentersGateway } from "./workspaceNettePresentersGateway";

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
      return {
        entries: entries.slice(0, maxEntries),
        truncated: entries.length > maxEntries,
      };
    }),
    readTextFileBounded: vi.fn(async (path: string, maxBytes: number) => {
      const source = sources[path];
      if (source === undefined) throw new Error(`Missing file: ${path}`);
      return new TextEncoder().encode(source).byteLength > maxBytes
        ? { status: "tooLarge" as const }
        : { status: "ok" as const, content: source };
    }),
  };
}

describe("WorkspaceNettePresentersGateway", () => {
  it("reuses existing bounded presenter and template discovery", async () => {
    const presenter = `${ROOT}/app/UI/Home/HomePresenter.php`;
    const template = `${ROOT}/app/UI/Home/default.latte`;
    const workspaceFiles = files(
      {
        [`${ROOT}/app`]: [directory(`${ROOT}/app/UI`)],
        [`${ROOT}/app/UI`]: [directory(`${ROOT}/app/UI/Home`)],
        [`${ROOT}/app/UI/Home`]: [file(presenter), file(template)],
      },
      { [presenter]: "<?php class HomePresenter { public function renderDefault(): void {} }" },
    );
    const gateway = new WorkspaceNettePresentersGateway(workspaceFiles);

    const result = await gateway.inspectNetteWorkspacePresenters(ROOT, []);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        total: 1,
        truncated: false,
        presenters: [
          expect.objectContaining({
            name: "Home",
            actions: [
              expect.objectContaining({
                name: "default",
                templates: [
                  { path: `${ROOT}/app/UI/Home/default.latte`, lineNumber: 1, column: 1 },
                ],
              }),
            ],
          }),
        ],
      }),
    );
    expect(workspaceFiles.readDirectoryBounded).toHaveBeenCalledWith(
      `${ROOT}/app`,
      expect.any(Number),
    );
  });

  it("reads a dirty presenter overlay through the existing discovery", async () => {
    const presenter = `${ROOT}/app/HomePresenter.php`;
    const workspaceFiles = files(
      { [`${ROOT}/app`]: [file(presenter)] },
      { [presenter]: "<?php class HomePresenter {}" },
    );
    const gateway = new WorkspaceNettePresentersGateway(workspaceFiles);

    const result = await gateway.inspectNetteWorkspacePresenters(ROOT, [
      {
        path: presenter,
        source: "<?php class HomePresenter { public function handleDirty(): void {} }",
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        presenters: [
          expect.objectContaining({
            signals: [expect.objectContaining({ name: "dirty" })],
          }),
        ],
      }),
    );
  });

  it("rejects traversal entries before asking the file gateway to read them", async () => {
    const escaped = `${ROOT}/app/../../outside/EscapePresenter.php`;
    const workspaceFiles = files(
      { [`${ROOT}/app`]: [file(escaped)] },
      { [escaped]: "<?php class EscapePresenter {}" },
    );
    const gateway = new WorkspaceNettePresentersGateway(workspaceFiles);

    const result = await gateway.inspectNetteWorkspacePresenters(ROOT, []);

    expect(result).toEqual(expect.objectContaining({ status: "ok", presenters: [] }));
    expect(workspaceFiles.readTextFileBounded).not.toHaveBeenCalledWith(
      escaped,
      expect.any(Number),
    );
  });

  it("marks a presenter discovery stopped at its cap as truncated", async () => {
    const first = `${ROOT}/app/AFirstPresenter.php`;
    const second = `${ROOT}/app/BSecondPresenter.php`;
    const gateway = new WorkspaceNettePresentersGateway(
      files(
        { [`${ROOT}/app`]: [file(first), file(second)] },
        {
          [first]: "<?php class AFirstPresenter {}",
          [second]: "<?php class BSecondPresenter {}",
        },
      ),
      { maxPresenters: 1 },
    );

    const result = await gateway.inspectNetteWorkspacePresenters(ROOT, []);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        total: 1,
        truncated: true,
      }),
    );
  });

  it("returns unavailable without touching discovery when no root is active", async () => {
    const workspaceFiles = files({}, {});
    const gateway = new WorkspaceNettePresentersGateway(workspaceFiles);

    await expect(gateway.inspectNetteWorkspacePresenters("", [])).resolves.toEqual({
      status: "unavailable",
      message: "No workspace is open.",
    });
    expect(workspaceFiles.readDirectoryBounded).not.toHaveBeenCalled();
  });

  it("fails closed when a native directory read reports truncation", async () => {
    const workspaceFiles = files({ [`${ROOT}/app`]: [] }, {});
    vi.mocked(workspaceFiles.readDirectoryBounded).mockResolvedValueOnce({
      entries: [],
      truncated: true,
    });
    const gateway = new WorkspaceNettePresentersGateway(workspaceFiles);

    await expect(gateway.inspectNetteWorkspacePresenters(ROOT, [])).resolves.toEqual({
      status: "error",
      message: "Nette presenter inspection exceeded its safety limits.",
    });
  });

  it("fails closed when a presenter exceeds the native byte limit", async () => {
    const presenter = `${ROOT}/app/HugePresenter.php`;
    const workspaceFiles = files({ [`${ROOT}/app`]: [file(presenter)] }, {});
    vi.mocked(workspaceFiles.readTextFileBounded).mockResolvedValueOnce({
      status: "tooLarge",
    });
    const gateway = new WorkspaceNettePresentersGateway(workspaceFiles);

    await expect(gateway.inspectNetteWorkspacePresenters(ROOT, [])).resolves.toEqual({
      status: "error",
      message: "Nette presenter inspection exceeded its safety limits.",
    });
  });
});
