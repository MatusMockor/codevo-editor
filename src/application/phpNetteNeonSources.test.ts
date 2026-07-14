import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import {
  isPhpNetteNeonConfigPath,
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
});

describe("phpNetteNeonConfigSourcesSignature", () => {
  it("changes when source content or file boundaries change", () => {
    const signature = phpNetteNeonConfigSourcesSignature(["a", "b"]);

    expect(signature).toBe(phpNetteNeonConfigSourcesSignature(["a", "b"]));
    expect(signature).not.toBe(phpNetteNeonConfigSourcesSignature(["a", "c"]));
    expect(signature).not.toBe(phpNetteNeonConfigSourcesSignature(["ab"]));
  });
});
