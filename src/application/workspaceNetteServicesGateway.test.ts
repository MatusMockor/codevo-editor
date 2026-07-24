import { describe, expect, it, vi } from "vitest";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import { WorkspaceNetteServicesGateway } from "./workspaceNetteServicesGateway";

const ROOT = "/workspace";

function file(path: string): FileEntry {
  return { kind: "file", name: path.split("/").pop() ?? path, path };
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

      if (!entries) {
        throw new Error(`Missing directory: ${path}`);
      }

      return { entries: entries.slice(0, maxEntries), truncated: entries.length > maxEntries };
    }),
    readTextFileBounded: vi.fn(async (path: string, maxBytes: number) => {
      const source = sources[path];

      if (source === undefined) {
        throw new Error(`Unreadable file: ${path}`);
      }

      return new TextEncoder().encode(source).byteLength > maxBytes
        ? { status: "tooLarge" as const }
        : { status: "ok" as const, content: source };
    }),
  };
}

describe("WorkspaceNetteServicesGateway", () => {
  it("reuses include-aware loading and preserves effective precedence", async () => {
    const rootPath = `${ROOT}/config/root.neon`;
    const overridePath = `${ROOT}/config/override.neon`;
    const basePath = `${ROOT}/shared/base.neon`;
    const gateway = new WorkspaceNetteServicesGateway(
      files(
        {
          [`${ROOT}/config`]: [file(rootPath), file(overridePath)],
        },
        {
          [rootPath]: [
            "includes:",
            "    - ../shared/base.neon",
            "    - override.neon",
            "services:",
            "    app: App\\Root",
          ].join("\n"),
          [overridePath]: "services:\n    mailer: App\\OverrideMailer",
          [basePath]: ["services:", "    mailer: App\\BaseMailer", "    base: App\\Base"].join(
            "\n",
          ),
        },
      ),
    );

    const result = await gateway.inspectNetteWorkspaceServices(ROOT, []);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.services.map(({ id, className }) => [id, className])).toEqual([
      ["app", "App\\Root"],
      ["mailer", "App\\OverrideMailer"],
      ["base", "App\\Base"],
    ]);
  });

  it("applies a dirty overlay to the loader's path-preserving entries", async () => {
    const path = `${ROOT}/config/services.neon`;
    const gateway = new WorkspaceNetteServicesGateway(
      files(
        { [`${ROOT}/config`]: [file(path)] },
        { [path]: "services:\n    mailer: App\\DiskMailer" },
      ),
    );

    const result = await gateway.inspectNetteWorkspaceServices(ROOT, [
      { path, source: "services:\n    mailer: App\\DirtyMailer" },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        services: [expect.objectContaining({ id: "mailer", className: "App\\DirtyMailer" })],
      }),
    );
  });

  it("uses a dirty root source while resolving its include graph", async () => {
    const rootPath = `${ROOT}/config/root.neon`;
    const dirtyIncludePath = `${ROOT}/shared/dirty.neon`;
    const gateway = new WorkspaceNetteServicesGateway(
      files(
        { [`${ROOT}/config`]: [file(rootPath)] },
        {
          [rootPath]: "includes:\n    - ../shared/disk.neon",
        },
      ),
    );

    const result = await gateway.inspectNetteWorkspaceServices(ROOT, [
      {
        path: rootPath,
        source: "includes:\n    - ../shared/dirty.neon\nservices:\n    root: App\\Root",
      },
      {
        path: dirtyIncludePath,
        source: "services:\n    included: App\\DirtyIncluded",
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        services: [
          expect.objectContaining({ id: "root", className: "App\\Root" }),
          expect.objectContaining({
            id: "included",
            className: "App\\DirtyIncluded",
          }),
        ],
      }),
    );
  });

  it("continues with readable sources when another discovered file cannot be read", async () => {
    const readable = `${ROOT}/config/readable.neon`;
    const unreadable = `${ROOT}/config/unreadable.neon`;
    const gateway = new WorkspaceNetteServicesGateway(
      files(
        { [`${ROOT}/config`]: [file(unreadable), file(readable)] },
        { [readable]: "services:\n    available: App\\Available" },
      ),
    );

    await expect(gateway.inspectNetteWorkspaceServices(ROOT, [])).resolves.toEqual(
      expect.objectContaining({
        status: "ok",
        services: [expect.objectContaining({ id: "available" })],
      }),
    );
  });

  it("fails explicitly when a source exceeds the bounded read budget", async () => {
    const path = `${ROOT}/config/huge.neon`;
    const skippedPath = `${ROOT}/config/skipped.neon`;
    const workspaceFiles = files(
      { [`${ROOT}/config`]: [file(path), file(skippedPath)] },
      { [path]: "x".repeat(600_000), [skippedPath]: "services: []" },
    );
    const gateway = new WorkspaceNetteServicesGateway(workspaceFiles);

    await expect(gateway.inspectNetteWorkspaceServices(ROOT, [])).resolves.toEqual({
      status: "error",
      message: "Nette workspace inspection exceeded its safety limits.",
    });
    expect(workspaceFiles.readTextFileBounded).toHaveBeenCalledOnce();
  });

  it("fails explicitly when directory entries exceed the traversal work budget", async () => {
    const entries = Array.from({ length: 20_001 }, (_, index) =>
      file(`${ROOT}/config/${index}.txt`),
    );
    const workspaceFiles = files({ [`${ROOT}/config`]: entries }, {});
    const gateway = new WorkspaceNetteServicesGateway(workspaceFiles);

    await expect(gateway.inspectNetteWorkspaceServices(ROOT, [])).resolves.toEqual({
      status: "error",
      message: "Nette workspace inspection exceeded its safety limits.",
    });
    expect(workspaceFiles.readDirectoryBounded).toHaveBeenCalledWith(`${ROOT}/config`, 20_000);
  });

  it("returns a tagged unavailable result before touching the reader", async () => {
    const workspaceFiles = files({}, {});
    const gateway = new WorkspaceNetteServicesGateway(workspaceFiles);

    await expect(gateway.inspectNetteWorkspaceServices("", [])).resolves.toEqual({
      status: "unavailable",
      message: "No workspace is open.",
    });
    expect(workspaceFiles.readDirectoryBounded).not.toHaveBeenCalled();
  });
});
