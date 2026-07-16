import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import {
  isPhpNetteNeonConfigPath,
  loadPhpNetteNeonConfigSourceEntries,
  loadPhpNetteNeonConfigSourceCollection,
  loadPhpNetteNeonConfigSources,
  phpNetteNeonConfigSourcesSignature,
  type PhpNetteNeonSourceReader,
} from "./phpNetteNeonSources";

function fileEntry(path: string): FileEntry {
  return { kind: "file", name: path.split("/").pop() ?? path, path };
}

function directoryEntry(path: string): FileEntry {
  return { kind: "directory", name: path.split("/").pop() ?? path, path };
}

function reader(
  entries: Record<string, FileEntry[]>,
  files: Record<string, string>,
): PhpNetteNeonSourceReader {
  return {
    readDirectory: vi.fn(async (path: string) => {
      if (!(path in entries)) {
        throw new Error(`No such directory: ${path}`);
      }

      return entries[path];
    }),
    readTextFile: vi.fn(async (path: string) => {
      if (!(path in files)) {
        throw new Error(`No such file: ${path}`);
      }

      return files[path];
    }),
  };
}

describe("isPhpNetteNeonConfigPath", () => {
  it("matches conventional Nette config locations", () => {
    expect(
      isPhpNetteNeonConfigPath("/workspace", "/workspace/config/config.neon"),
    ).toBe(true);
    expect(
      isPhpNetteNeonConfigPath(
        "/workspace",
        "/workspace/app/config/services.neon",
      ),
    ).toBe(true);
    expect(
      isPhpNetteNeonConfigPath(
        "/workspace",
        "/workspace/app/modules/invoiceModule/config/config.neon",
      ),
    ).toBe(true);
  });

  it("rejects non-NEON files and paths outside the workspace root", () => {
    expect(
      isPhpNetteNeonConfigPath("/workspace", "/workspace/config/config.php"),
    ).toBe(false);
    expect(
      isPhpNetteNeonConfigPath("/workspace", "/workspace/app/Model/User.php"),
    ).toBe(false);
    expect(
      isPhpNetteNeonConfigPath(
        "/workspace-a",
        "/workspace-b/config/config.neon",
      ),
    ).toBe(false);
  });
});

describe("loadPhpNetteNeonConfigSources", () => {
  it("loads NEON sources from conventional roots in stable path order", async () => {
    const gateway = reader(
      {
        "/workspace/config": [
          fileEntry("/workspace/config/services.neon"),
          fileEntry("/workspace/config/readme.md"),
        ],
        "/workspace/app/config": [
          fileEntry("/workspace/app/config/local.neon"),
        ],
        "/workspace/app/modules": [
          directoryEntry("/workspace/app/modules/invoiceModule"),
        ],
        "/workspace/app/modules/invoiceModule": [
          directoryEntry("/workspace/app/modules/invoiceModule/config"),
        ],
        "/workspace/app/modules/invoiceModule/config": [
          fileEntry("/workspace/app/modules/invoiceModule/config/config.neon"),
        ],
      },
      {
        "/workspace/app/config/local.neon": "services:\n  local: App\\Local",
        "/workspace/app/modules/invoiceModule/config/config.neon":
          "services:\n  invoice: App\\Invoice",
        "/workspace/config/services.neon": "services:\n  app: App\\Service",
      },
    );

    await expect(
      loadPhpNetteNeonConfigSources("/workspace", gateway),
    ).resolves.toEqual([
      "services:\n  local: App\\Local",
      "services:\n  invoice: App\\Invoice",
      "services:\n  app: App\\Service",
    ]);
  });

  it("is graceful when directories or files are missing", async () => {
    const gateway = reader(
      {
        "/workspace/config": [fileEntry("/workspace/config/config.neon")],
      },
      {},
    );

    await expect(
      loadPhpNetteNeonConfigSources("/workspace", gateway),
    ).resolves.toEqual([]);
  });

  it("orders sources by include precedence instead of lexical path", async () => {
    const root = "includes:\n  - z-base.neon\n  - a-override.neon\nservices:\n  mailer: App\\RootMailer";
    const base = "services:\n  mailer: App\\BaseMailer";
    const override = "services:\n  mailer: App\\OverrideMailer";
    const gateway = reader(
      {
        "/workspace/config": [
          fileEntry("/workspace/config/a-override.neon"),
          fileEntry("/workspace/config/root.neon"),
          fileEntry("/workspace/config/z-base.neon"),
        ],
      },
      {
        "/workspace/config/a-override.neon": override,
        "/workspace/config/root.neon": root,
        "/workspace/config/z-base.neon": base,
      },
    );

    await expect(
      loadPhpNetteNeonConfigSourceEntries("/workspace", gateway),
    ).resolves.toEqual([
      { path: "/workspace/config/root.neon", source: root },
      { path: "/workspace/config/a-override.neon", source: override },
      { path: "/workspace/config/z-base.neon", source: base },
    ]);
  });

  it("traverses cyclic includes deterministically and only once", async () => {
    const first = "includes:\n  - b.neon\nservices:\n  first: App\\First";
    const second = "includes:\n  - a.neon\nservices:\n  second: App\\Second";
    const gateway = reader(
      {
        "/workspace/config": [
          fileEntry("/workspace/config/b.neon"),
          fileEntry("/workspace/config/a.neon"),
        ],
      },
      {
        "/workspace/config/a.neon": first,
        "/workspace/config/b.neon": second,
      },
    );

    await expect(
      loadPhpNetteNeonConfigSources("/workspace", gateway),
    ).resolves.toEqual([first, second]);
  });

  it("recursively loads valid includes outside conventional scan directories", async () => {
    const root = "includes:\n  - ../shared/services.neon\nservices:\n  app: App\\Root";
    const shared = "services:\n  mailer: App\\SharedMailer";
    const gateway = reader(
      {
        "/workspace/config": [fileEntry("/workspace/config/root.neon")],
      },
      {
        "/workspace/config/root.neon": root,
        "/workspace/shared/services.neon": shared,
      },
    );

    await expect(
      loadPhpNetteNeonConfigSourceCollection("/workspace", gateway),
    ).resolves.toEqual({
      discoveredPaths: new Set([
        "/workspace/config/root.neon",
        "/workspace/shared/services.neon",
      ]),
      entries: [
        { path: "/workspace/config/root.neon", source: root },
        { path: "/workspace/shared/services.neon", source: shared },
      ],
    });
  });

  it("tracks missing includes but rejects paths outside the workspace", async () => {
    const root = [
      "includes:",
      "  - ../shared/missing.neon",
      "  - ../../outside.neon",
    ].join("\n");
    const gateway = reader(
      {
        "/workspace/config": [fileEntry("/workspace/config/root.neon")],
      },
      { "/workspace/config/root.neon": root },
    );

    const collection = await loadPhpNetteNeonConfigSourceCollection(
      "/workspace",
      gateway,
    );

    expect(collection.entries).toEqual([
      { path: "/workspace/config/root.neon", source: root },
    ]);
    expect(collection.discoveredPaths).toEqual(
      new Set([
        "/workspace/config/root.neon",
        "/workspace/shared/missing.neon",
      ]),
    );
  });
});

describe("phpNetteNeonConfigSourcesSignature", () => {
  it("changes when source content or file boundaries change", () => {
    const signature = phpNetteNeonConfigSourcesSignature(["a", "b"]);

    expect(signature).toBe(phpNetteNeonConfigSourcesSignature(["a", "b"]));
    expect(signature).not.toBe(phpNetteNeonConfigSourcesSignature(["a", "c"]));
    expect(signature).not.toBe(phpNetteNeonConfigSourcesSignature(["ab"]));
  });
});
