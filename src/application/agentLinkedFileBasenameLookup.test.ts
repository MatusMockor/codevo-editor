import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES } from "../domain/agentMarkdown/agentLinkedFileBasenameMatch";
import type { FileEntry, FileSearchResponse, FileSearchResult } from "../domain/workspace";
import {
  LINKED_FILE_SEARCH_GENERATION,
  findLinkedFileByBasename,
  openNamedLinkedFile,
  type LinkedFileSearch,
  type NamedLinkedFileOpening,
} from "./agentLinkedFileBasenameLookup";
import type { LinkedFileDirectoryReader } from "./agentLinkedFileProbe";

const ROOT = "/workspace/app";

type SearchFiles = NonNullable<LinkedFileSearch["searchFilesWithMetadata"]>;

function entry(path: string, kind: FileEntry["kind"] = "file"): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind };
}

function result(relativePath: string): FileSearchResult {
  return {
    name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    path: `${ROOT}/${relativePath}`,
    relativePath,
  };
}

function response(
  relativePaths: ReadonlyArray<string>,
  truncated = false,
  requestGeneration = LINKED_FILE_SEARCH_GENERATION,
): FileSearchResponse {
  return { requestGeneration, results: relativePaths.map(result), truncated };
}

function directories(
  listings: Readonly<Record<string, ReadonlyArray<FileEntry>>>,
): LinkedFileDirectoryReader {
  return {
    readDirectoryBounded: async (path) => {
      const entries = listings[path];
      if (entries === undefined) throw new Error(`ENOENT ${path}`);
      return { entries, truncated: false };
    },
  };
}

function searchFor(...relativePaths: ReadonlyArray<string>) {
  return vi.fn<SearchFiles>(async () => response(relativePaths));
}

function opening(
  overrides: Partial<NamedLinkedFileOpening> = {},
): NamedLinkedFileOpening & { readonly opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    directories: directories({ [ROOT]: [entry(`${ROOT}/package.json`)] }),
    search: { searchFilesWithMetadata: searchFor("src/components/ChatView.tsx") },
    isCurrent: () => true,
    open: async (path) => {
      opened.push(path);
      return true;
    },
    ...overrides,
  };
}

describe("openNamedLinkedFile", () => {
  it("opens a bare name that exists at the root without searching", async () => {
    const searchFilesWithMetadata = searchFor();
    const view = opening({
      directories: directories({ [ROOT]: [entry(`${ROOT}/ChatView.tsx`)] }),
      search: { searchFilesWithMetadata },
    });

    await expect(openNamedLinkedFile(`${ROOT}/ChatView.tsx`, ROOT, view)).resolves.toBe("opened");
    expect(view.opened).toEqual([`${ROOT}/ChatView.tsx`]);
    expect(searchFilesWithMetadata).not.toHaveBeenCalled();
  });

  it("opens the project file with that name when the root has none", async () => {
    const searchFilesWithMetadata = searchFor("src/components/ChatView.tsx", "src/ChatViewer.tsx");
    const view = opening({
      directories: directories({
        [ROOT]: [entry(`${ROOT}/src`, "directory")],
        [`${ROOT}/src/components`]: [entry(`${ROOT}/src/components/ChatView.tsx`)],
      }),
      search: { searchFilesWithMetadata },
    });

    await expect(openNamedLinkedFile(`${ROOT}/ChatView.tsx`, ROOT, view)).resolves.toBe("opened");
    expect(searchFilesWithMetadata).toHaveBeenCalledExactlyOnceWith(
      ROOT,
      "ChatView.tsx",
      MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES,
      LINKED_FILE_SEARCH_GENERATION,
    );
    expect(view.opened).toEqual([`${ROOT}/src/components/ChatView.tsx`]);
  });

  it("reports notFound when the name is missing or ambiguous", async () => {
    const missing = opening({ search: { searchFilesWithMetadata: searchFor("src/auth.ts") } });
    await expect(openNamedLinkedFile(`${ROOT}/auth.json`, ROOT, missing)).resolves.toBe("notFound");
    const ambiguous = opening({
      search: { searchFilesWithMetadata: searchFor("a/auth.json", "b/auth.json") },
    });
    await expect(openNamedLinkedFile(`${ROOT}/auth.json`, ROOT, ambiguous)).resolves.toBe(
      "notFound",
    );
    expect([...missing.opened, ...ambiguous.opened]).toEqual([]);
  });

  it("does not open the one match a truncated search happened to see", async () => {
    const searchFilesWithMetadata = vi.fn<SearchFiles>(async () =>
      response(["src/ChatView.tsx"], true),
    );
    const view = opening({
      directories: directories({
        [ROOT]: [entry(`${ROOT}/src`, "directory")],
        [`${ROOT}/src`]: [entry(`${ROOT}/src/ChatView.tsx`)],
      }),
      search: { searchFilesWithMetadata },
    });

    await expect(openNamedLinkedFile(`${ROOT}/ChatView.tsx`, ROOT, view)).resolves.toBe("notFound");
    expect(view.opened).toEqual([]);
  });

  it("reports notFound when there is no complete search or it fails", async () => {
    const none = opening({ search: null });
    await expect(openNamedLinkedFile(`${ROOT}/auth.json`, ROOT, none)).resolves.toBe("notFound");
    const withoutMetadata = opening({ search: {} });
    await expect(openNamedLinkedFile(`${ROOT}/auth.json`, ROOT, withoutMetadata)).resolves.toBe(
      "notFound",
    );
    const failing = opening({
      search: { searchFilesWithMetadata: async () => Promise.reject(new Error("search failed")) },
    });
    await expect(openNamedLinkedFile(`${ROOT}/auth.json`, ROOT, failing)).resolves.toBe("notFound");
    const foreign = opening({
      search: { searchFilesWithMetadata: async () => response(["src/auth.json"], false, "other") },
    });
    await expect(openNamedLinkedFile(`${ROOT}/auth.json`, ROOT, foreign)).resolves.toBe("notFound");
  });

  it("drops a lookup that settles after a newer request", async () => {
    let live = true;
    let release: (found: FileSearchResponse) => void = () => undefined;
    const searchFilesWithMetadata = vi.fn<SearchFiles>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = opening({ search: { searchFilesWithMetadata }, isCurrent: () => live });

    const pending = openNamedLinkedFile(`${ROOT}/ChatView.tsx`, ROOT, view);
    await vi.waitFor(() => expect(searchFilesWithMetadata).toHaveBeenCalledOnce());
    live = false;
    release(response(["src/ChatView.tsx"]));

    await expect(pending).resolves.toBe("superseded");
    expect(view.opened).toEqual([]);
  });

  it("supersedes a match whose open finished after a newer request", async () => {
    let live = true;
    let finish: (accepted: boolean) => void = () => undefined;
    const opened: string[] = [];
    const view = opening({
      directories: directories({
        [ROOT]: [entry(`${ROOT}/src`, "directory")],
        [`${ROOT}/src/components`]: [entry(`${ROOT}/src/components/ChatView.tsx`)],
      }),
      isCurrent: () => live,
      open: (path) =>
        new Promise((resolve) => {
          opened.push(path);
          finish = resolve;
        }),
    });

    const pending = openNamedLinkedFile(`${ROOT}/ChatView.tsx`, ROOT, view);
    await vi.waitFor(() => expect(opened).toEqual([`${ROOT}/src/components/ChatView.tsx`]));
    live = false;
    finish(true);

    await expect(pending).resolves.toBe("superseded");
  });
});

describe("findLinkedFileByBasename", () => {
  it("does not search for an empty name", async () => {
    const searchFilesWithMetadata = searchFor("a.ts");
    await expect(
      findLinkedFileByBasename("", ROOT, { searchFilesWithMetadata }),
    ).resolves.toBeNull();
    expect(searchFilesWithMetadata).not.toHaveBeenCalled();
  });
});
