import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import {
  MAX_LINKED_FILE_PROBE_ENTRIES,
  classifyUnopenedLinkedFile,
  openOrClassifyLinkedFile,
  type LinkedFileDirectoryReader,
} from "./agentLinkedFileProbe";

const ROOT = "/workspace/app";

function file(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}

function directory(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "directory" };
}

function reader(
  listings: Readonly<Record<string, ReadonlyArray<FileEntry>>>,
  truncated: ReadonlySet<string> = new Set(),
): LinkedFileDirectoryReader & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    readDirectoryBounded: vi.fn(async (path: string, maxEntries: number) => {
      calls.push(path);
      expect(maxEntries).toBe(MAX_LINKED_FILE_PROBE_ENTRIES);
      const entries = listings[path];
      if (entries === undefined) throw new Error(`ENOENT ${path}`);
      return { entries, truncated: truncated.has(path) };
    }),
  };
}

describe("classifyUnopenedLinkedFile", () => {
  it("reports notFound when the parent directory lists without the file", async () => {
    const files = reader({ [`${ROOT}/src`]: [file(`${ROOT}/src/main.ts`)] });
    await expect(
      classifyUnopenedLinkedFile(`${ROOT}/src/environment.prod.ts`, ROOT, files),
    ).resolves.toBe("notFound");
    expect(files.calls).toEqual([`${ROOT}/src`]);
  });

  it("reports unreadable when the file is listed but could not be opened", async () => {
    const files = reader({ [`${ROOT}/src`]: [file(`${ROOT}/src/secret.ts`)] });
    await expect(classifyUnopenedLinkedFile(`${ROOT}/src/secret.ts`, ROOT, files)).resolves.toBe(
      "unreadable",
    );
  });

  it("does not call a case-only match or a directory an unreadable file", async () => {
    const files = reader({
      [`${ROOT}/src`]: [file(`${ROOT}/src/Config.ts`), directory(`${ROOT}/src/utils`)],
    });
    await expect(classifyUnopenedLinkedFile(`${ROOT}/src/config.ts`, ROOT, files)).resolves.toBe(
      "failed",
    );
    await expect(classifyUnopenedLinkedFile(`${ROOT}/src/utils`, ROOT, files)).resolves.toBe(
      "failed",
    );
  });

  it("walks up to the first listable ancestor and reports a missing directory as notFound", async () => {
    const files = reader({ [ROOT]: [directory(`${ROOT}/src`)] });
    await expect(
      classifyUnopenedLinkedFile(`${ROOT}/gone/deep/file.ts`, ROOT, files),
    ).resolves.toBe("notFound");
    expect(files.calls).toEqual([`${ROOT}/gone/deep`, `${ROOT}/gone`, ROOT]);
  });

  it("does not guess when an existing ancestor directory cannot be listed", async () => {
    const files = reader({ [ROOT]: [directory(`${ROOT}/locked`)] });
    await expect(classifyUnopenedLinkedFile(`${ROOT}/locked/a.ts`, ROOT, files)).resolves.toBe(
      "failed",
    );
  });

  it("does not claim absence from a truncated listing", async () => {
    const files = reader({ [`${ROOT}/src`]: [] }, new Set([`${ROOT}/src`]));
    await expect(classifyUnopenedLinkedFile(`${ROOT}/src/a.ts`, ROOT, files)).resolves.toBe(
      "failed",
    );
  });

  it("never lists above the project root", async () => {
    const files = reader({ "/workspace": [directory(ROOT)] });
    await expect(classifyUnopenedLinkedFile(`${ROOT}/a.ts`, ROOT, files)).resolves.toBe("failed");
    expect(files.calls).toEqual([ROOT]);
  });

  it("refuses a path that is not inside the root", async () => {
    const files = reader({ "/etc": [file("/etc/hosts")] });
    await expect(classifyUnopenedLinkedFile("/etc/hosts", ROOT, files)).resolves.toBe("failed");
    expect(files.calls).toEqual([]);
  });

  it("falls back to an unbounded listing when the bounded read is unavailable", async () => {
    const readDirectory = vi.fn(async () => [file(`${ROOT}/other.ts`)]);
    await expect(classifyUnopenedLinkedFile(`${ROOT}/a.ts`, ROOT, { readDirectory })).resolves.toBe(
      "notFound",
    );
    expect(readDirectory).toHaveBeenCalledExactlyOnceWith(ROOT);
  });
});

describe("openOrClassifyLinkedFile", () => {
  it("reports an opened file without probing the directory", async () => {
    const files = reader({});
    const open = vi.fn(async () => true);
    await expect(openOrClassifyLinkedFile(open, `${ROOT}/src/a.ts`, ROOT, files)).resolves.toBe(
      "opened",
    );
    expect(open).toHaveBeenCalledOnce();
    expect(files.calls).toEqual([]);
  });

  it("classifies a file the editor could not open", async () => {
    const files = reader({ [`${ROOT}/src`]: [] });
    await expect(
      openOrClassifyLinkedFile(async () => false, `${ROOT}/src/a.ts`, ROOT, files),
    ).resolves.toBe("notFound");
    expect(files.calls).toEqual([`${ROOT}/src`]);
  });
});
