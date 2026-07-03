import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceTargetCollector,
  type WorkspaceTargetCache,
  type WorkspaceTargetCollectorDeps,
  type WorkspaceTargetDefinition,
} from "./phpWorkspaceTargetCollector";
import type { FileEntry, TextSearchResult } from "../domain/workspace";

const ROOT = "/workspace";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");

  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }

  return path;
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replace(/\/+$/, "")}/${relativePath}`;
}

function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

function searchResult(path: string): TextSearchResult {
  return {
    path,
    relativePath: relativeWorkspacePath(ROOT, path),
    lineNumber: 1,
    column: 1,
    lineText: "",
  };
}

interface FakeDeps {
  deps: WorkspaceTargetCollectorDeps;
  ref: { current: string | null };
  searchText: ReturnType<typeof vi.fn>;
  readFileContent: ReturnType<typeof vi.fn>;
  readWorkspaceDirectory: ReturnType<typeof vi.fn>;
}

function createDeps(
  overrides: {
    searchText?: (root: string, query: string) => Promise<TextSearchResult[]>;
    readFileContent?: (path: string) => Promise<string>;
    readWorkspaceDirectory?: (path: string) => Promise<FileEntry[]>;
  } = {},
): FakeDeps {
  const ref: { current: string | null } = { current: ROOT };
  const searchText = vi.fn(
    overrides.searchText ??
      (async () => [] as TextSearchResult[]),
  );
  const readFileContent = vi.fn(
    overrides.readFileContent ?? (async () => ""),
  );
  const readWorkspaceDirectory = vi.fn(
    overrides.readWorkspaceDirectory ?? (async () => [] as FileEntry[]),
  );

  const deps: WorkspaceTargetCollectorDeps = {
    currentWorkspaceRootRef: ref,
    textSearch: { searchText: searchText as never },
    readFileContent: readFileContent as never,
    readWorkspaceDirectory: readWorkspaceDirectory as never,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
  };

  return { deps, ref, searchText, readFileContent, readWorkspaceDirectory };
}

function fileEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return { name, path, kind: "file" };
}

function directoryEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return { name, path, kind: "directory" };
}

// A fake parser: each line of content is `NAME@LINE:COLUMN`, so tests control
// the exact definitions a file yields.
function parseFakeDefinitions(source: string): WorkspaceTargetDefinition[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, position] = line.split("@");
      const [lineNumber, column] = (position ?? "1:1").split(":");
      return {
        name,
        position: {
          lineNumber: Number(lineNumber),
          column: Number(column),
        },
      };
    });
}

describe("createWorkspaceTargetCollector - textSearch source", () => {
  it("seeds the current document, merges searched files, dedups and sorts", async () => {
    const filesByPath: Record<string, string> = {
      [`${ROOT}/routes/web.php`]: "beta@2:3\nalpha@5:1",
      [`${ROOT}/routes/api.php`]: "alpha@5:1", // duplicate name+pos but different path
    };
    const { deps, searchText } = createDeps({
      searchText: async () => [
        searchResult(`${ROOT}/routes/web.php`),
        searchResult(`${ROOT}/routes/api.php`),
        searchResult(`${ROOT}/routes/web.php`), // repeated -> visited dedup
      ],
      readFileContent: async (path) => filesByPath[path] ?? "",
    });

    const collect = createWorkspaceTargetCollector(deps, {
      kind: "textSearch",
      isEnabled: () => true,
      queries: () => ["Route::"],
      parseDefinitions: parseFakeDefinitions,
    });

    const targets = await collect({
      workspaceRoot: ROOT,
      currentDocument: {
        content: "gamma@9:9",
        path: `${ROOT}/routes/current.php`,
      },
    });

    expect(searchText).toHaveBeenCalledWith(ROOT, "Route::", 200);
    expect(
      targets.map((target) => ({
        name: target.name,
        path: target.path,
        relativePath: target.relativePath,
        position: target.position,
      })),
    ).toEqual([
      // sorted by name, then path
      {
        name: "alpha",
        path: `${ROOT}/routes/api.php`,
        relativePath: "routes/api.php",
        position: { lineNumber: 5, column: 1 },
      },
      {
        name: "alpha",
        path: `${ROOT}/routes/web.php`,
        relativePath: "routes/web.php",
        position: { lineNumber: 5, column: 1 },
      },
      {
        name: "beta",
        path: `${ROOT}/routes/web.php`,
        relativePath: "routes/web.php",
        position: { lineNumber: 2, column: 3 },
      },
      {
        name: "gamma",
        path: `${ROOT}/routes/current.php`,
        relativePath: "routes/current.php",
        position: { lineNumber: 9, column: 9 },
      },
    ]);
    // The current document is only read from the passed source, never re-read.
    expect(deps.readFileContent).not.toHaveBeenCalledWith(
      `${ROOT}/routes/current.php`,
    );
  });

  it("reads a file matched by two queries once and keeps its definitions once", async () => {
    // The middleware-alias collector fans out two anchors ("middlewareAliases"
    // and "routeMiddleware"); a Kernel that matches both must be read a single
    // time and contribute its aliases only once.
    const { deps, readFileContent } = createDeps({
      searchText: async () => [searchResult(`${ROOT}/app/Http/Kernel.php`)],
      readFileContent: async () => "auth@3:1\nverified@4:1",
    });

    const collect = createWorkspaceTargetCollector(deps, {
      kind: "textSearch",
      isEnabled: () => true,
      queries: () => ["middlewareAliases", "routeMiddleware"],
      parseDefinitions: parseFakeDefinitions,
    });

    const targets = await collect({
      workspaceRoot: ROOT,
      currentDocument: { content: "", path: `${ROOT}/current.php` },
    });

    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(readFileContent).toHaveBeenCalledWith(`${ROOT}/app/Http/Kernel.php`);
    expect(targets.map((target) => target.name)).toEqual(["auth", "verified"]);
  });

  it("runs every query in parallel and flattens the results", async () => {
    const { deps, searchText } = createDeps({
      searchText: async (_root, query) =>
        query === "A" ? [searchResult(`${ROOT}/a.php`)] : [searchResult(`${ROOT}/b.php`)],
      readFileContent: async (path) =>
        path.endsWith("a.php") ? "one@1:1" : "two@1:1",
    });

    const collect = createWorkspaceTargetCollector(deps, {
      kind: "textSearch",
      isEnabled: () => true,
      queries: () => ["A", "B"],
      parseDefinitions: parseFakeDefinitions,
    });

    const targets = await collect({
      workspaceRoot: ROOT,
      currentDocument: { content: "", path: `${ROOT}/current.php` },
    });

    expect(searchText).toHaveBeenCalledTimes(2);
    expect(targets.map((target) => target.name)).toEqual(["one", "two"]);
  });

  it("skips non-php and already-visited files", async () => {
    const { deps, readFileContent } = createDeps({
      searchText: async () => [
        searchResult(`${ROOT}/notes.txt`),
        searchResult(`${ROOT}/a.php`),
        searchResult(`${ROOT}/a.php`),
      ],
      readFileContent: async () => "only@1:1",
    });

    const collect = createWorkspaceTargetCollector(deps, {
      kind: "textSearch",
      isEnabled: () => true,
      queries: () => ["q"],
      parseDefinitions: parseFakeDefinitions,
    });

    await collect({
      workspaceRoot: ROOT,
      currentDocument: { content: "", path: `${ROOT}/current.php` },
    });

    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(readFileContent).toHaveBeenCalledWith(`${ROOT}/a.php`);
  });

  it("continues past a file that fails to read", async () => {
    const { deps } = createDeps({
      searchText: async () => [
        searchResult(`${ROOT}/broken.php`),
        searchResult(`${ROOT}/ok.php`),
      ],
      readFileContent: async (path) => {
        if (path.endsWith("broken.php")) {
          throw new Error("read failed");
        }
        return "survivor@1:1";
      },
    });

    const collect = createWorkspaceTargetCollector(deps, {
      kind: "textSearch",
      isEnabled: () => true,
      queries: () => ["q"],
      parseDefinitions: parseFakeDefinitions,
    });

    const targets = await collect({
      workspaceRoot: ROOT,
      currentDocument: { content: "", path: `${ROOT}/current.php` },
    });

    expect(targets.map((target) => target.name)).toEqual(["survivor"]);
  });

  it("returns empty without searching when disabled or root is null", async () => {
    const disabled = createDeps();
    const collectDisabled = createWorkspaceTargetCollector(disabled.deps, {
      kind: "textSearch",
      isEnabled: () => false,
      queries: () => ["q"],
      parseDefinitions: parseFakeDefinitions,
    });
    expect(
      await collectDisabled({
        workspaceRoot: ROOT,
        currentDocument: { content: "x@1:1", path: `${ROOT}/c.php` },
      }),
    ).toEqual([]);
    expect(disabled.searchText).not.toHaveBeenCalled();

    const noRoot = createDeps();
    const collectNoRoot = createWorkspaceTargetCollector(noRoot.deps, {
      kind: "textSearch",
      isEnabled: () => true,
      queries: () => ["q"],
      parseDefinitions: parseFakeDefinitions,
    });
    expect(
      await collectNoRoot({
        workspaceRoot: null,
        currentDocument: { content: "x@1:1", path: "/c.php" },
      }),
    ).toEqual([]);
    expect(noRoot.searchText).not.toHaveBeenCalled();
  });

  it("drops results when the workspace root changes during the search", async () => {
    const deferred = createDeferred<TextSearchResult[]>();
    const { deps, ref } = createDeps({
      searchText: () => deferred.promise,
      readFileContent: async () => "late@1:1",
    });

    const collect = createWorkspaceTargetCollector(deps, {
      kind: "textSearch",
      isEnabled: () => true,
      queries: () => ["q"],
      parseDefinitions: parseFakeDefinitions,
    });

    const pending = collect({
      workspaceRoot: ROOT,
      currentDocument: { content: "", path: `${ROOT}/c.php` },
    });

    ref.current = "/other";
    deferred.resolve([searchResult(`${ROOT}/a.php`)]);

    expect(await pending).toEqual([]);
  });

  it("drops results when the workspace root changes during a file read", async () => {
    const deferred = createDeferred<string>();
    const { deps, ref } = createDeps({
      searchText: async () => [searchResult(`${ROOT}/a.php`)],
      readFileContent: () => deferred.promise,
    });

    const collect = createWorkspaceTargetCollector(deps, {
      kind: "textSearch",
      isEnabled: () => true,
      queries: () => ["q"],
      parseDefinitions: parseFakeDefinitions,
    });

    const pending = collect({
      workspaceRoot: ROOT,
      currentDocument: { content: "", path: `${ROOT}/c.php` },
    });

    await Promise.resolve();
    ref.current = "/other";
    deferred.resolve("late@1:1");

    expect(await pending).toEqual([]);
  });
});

describe("createWorkspaceTargetCollector - knownFiles source", () => {
  interface FakeEnvTarget {
    name: string;
    path: string;
    relativePath: string;
  }

  const parseEnv = ({
    content,
    path,
    relativePath,
  }: {
    content: string;
    path: string;
    relativePath: string;
  }): FakeEnvTarget[] =>
    content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((name) => ({ name, path, relativePath }));

  it("returns the first readable file's targets and never reads later files", async () => {
    const { deps, readFileContent } = createDeps({
      readFileContent: async (path) =>
        path.endsWith(".env") ? "APP_NAME\nAPP_ENV" : "SHOULD_NOT_READ",
    });

    const collect = createWorkspaceTargetCollector<FakeEnvTarget>(deps, {
      kind: "knownFiles",
      isEnabled: () => true,
      relativePaths: [".env", ".env.example"],
      parseTargets: parseEnv,
    });

    const targets = await collect({ workspaceRoot: ROOT });

    expect(targets).toEqual([
      { name: "APP_NAME", path: `${ROOT}/.env`, relativePath: ".env" },
      { name: "APP_ENV", path: `${ROOT}/.env`, relativePath: ".env" },
    ]);
    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(readFileContent).toHaveBeenCalledWith(`${ROOT}/.env`);
  });

  it("falls through to the next known file when the first read throws", async () => {
    const { deps, readFileContent } = createDeps({
      readFileContent: async (path) => {
        if (path.endsWith(".env")) {
          throw new Error("missing");
        }
        return "FROM_EXAMPLE";
      },
    });

    const collect = createWorkspaceTargetCollector<FakeEnvTarget>(deps, {
      kind: "knownFiles",
      isEnabled: () => true,
      relativePaths: [".env", ".env.example"],
      parseTargets: parseEnv,
    });

    const targets = await collect({ workspaceRoot: ROOT });

    expect(targets).toEqual([
      {
        name: "FROM_EXAMPLE",
        path: `${ROOT}/.env.example`,
        relativePath: ".env.example",
      },
    ]);
    expect(readFileContent).toHaveBeenCalledTimes(2);
  });

  it("returns the first readable file even when it parses to no targets", async () => {
    const { deps, readFileContent } = createDeps({
      readFileContent: async () => "",
    });

    const collect = createWorkspaceTargetCollector<FakeEnvTarget>(deps, {
      kind: "knownFiles",
      isEnabled: () => true,
      relativePaths: [".env", ".env.example"],
      parseTargets: parseEnv,
    });

    expect(await collect({ workspaceRoot: ROOT })).toEqual([]);
    expect(readFileContent).toHaveBeenCalledTimes(1);
  });

  it("returns empty when disabled or root is null", async () => {
    const disabled = createDeps({ readFileContent: async () => "X" });
    const collectDisabled = createWorkspaceTargetCollector<FakeEnvTarget>(
      disabled.deps,
      {
        kind: "knownFiles",
        isEnabled: () => false,
        relativePaths: [".env"],
        parseTargets: parseEnv,
      },
    );
    expect(await collectDisabled({ workspaceRoot: ROOT })).toEqual([]);
    expect(disabled.readFileContent).not.toHaveBeenCalled();

    const noRoot = createDeps({ readFileContent: async () => "X" });
    const collectNoRoot = createWorkspaceTargetCollector<FakeEnvTarget>(
      noRoot.deps,
      {
        kind: "knownFiles",
        isEnabled: () => true,
        relativePaths: [".env"],
        parseTargets: parseEnv,
      },
    );
    expect(await collectNoRoot({ workspaceRoot: null })).toEqual([]);
    expect(noRoot.readFileContent).not.toHaveBeenCalled();
  });

  it("drops results when the workspace root changes during the read", async () => {
    const deferred = createDeferred<string>();
    const { deps, ref } = createDeps({
      readFileContent: () => deferred.promise,
    });

    const collect = createWorkspaceTargetCollector<FakeEnvTarget>(deps, {
      kind: "knownFiles",
      isEnabled: () => true,
      relativePaths: [".env"],
      parseTargets: parseEnv,
    });

    const pending = collect({ workspaceRoot: ROOT });

    await Promise.resolve();
    ref.current = "/other";
    deferred.resolve("LATE");

    expect(await pending).toEqual([]);
  });
});

describe("createWorkspaceTargetCollector - directoryScan source", () => {
  interface FakeViewTarget {
    name: string;
    path: string;
    relativePath: string;
  }

  interface FakeConfigTarget {
    key: string;
    path: string;
    relativePath: string;
  }

  // View-style parser: derive a name from the relative path, never read content.
  const parseView = ({
    relativePath,
    path,
  }: {
    relativePath: string;
    path: string;
    content?: string;
  }): FakeViewTarget[] => {
    const withoutRoot = relativePath.replace(/^views\//, "");
    const withoutExt = withoutRoot.endsWith(".blade.php")
      ? withoutRoot.slice(0, -".blade.php".length)
      : null;
    if (!withoutExt) {
      return [];
    }
    return [{ name: withoutExt.split("/").join("."), path, relativePath }];
  };

  // Config-style parser: a file-level target from the metadata pass (survives a
  // read failure) plus one target per non-empty content line from the content
  // pass.
  const parseConfig = ({
    relativePath,
    path,
    content,
  }: {
    relativePath: string;
    path: string;
    content?: string;
  }): FakeConfigTarget[] => {
    const match = /^config\/([^/]+)\.php$/.exec(relativePath);
    const fileName = match?.[1] ?? null;
    if (!fileName) {
      return [];
    }
    const fileTarget: FakeConfigTarget = { key: fileName, path, relativePath };
    if (content === undefined) {
      return [fileTarget];
    }
    const keys = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((key) => ({ key, path, relativePath }));
    return [fileTarget, ...keys];
  };

  it("recursively scans a directory tree without reading file content", async () => {
    const { deps, readFileContent } = createDeps({
      readWorkspaceDirectory: async (path) => {
        if (path === `${ROOT}/views`) {
          return [
            directoryEntry(`${ROOT}/views/comments`),
            fileEntry(`${ROOT}/views/welcome.blade.php`),
          ];
        }
        if (path === `${ROOT}/views/comments`) {
          return [
            fileEntry(`${ROOT}/views/comments/show.blade.php`),
            fileEntry(`${ROOT}/views/comments/readme.txt`),
          ];
        }
        return [];
      },
    });

    const collect = createWorkspaceTargetCollector<FakeViewTarget>(deps, {
      kind: "directoryScan",
      isEnabled: () => true,
      roots: ["views"],
      recursive: true,
      parseEntry: parseView,
      dedupKey: (target) => target.name.toLowerCase(),
      compareTargets: (left, right) => left.name.localeCompare(right.name),
    });

    const targets = await collect({ workspaceRoot: ROOT });

    expect(readFileContent).not.toHaveBeenCalled();
    expect(targets).toEqual([
      {
        name: "comments.show",
        path: `${ROOT}/views/comments/show.blade.php`,
        relativePath: "views/comments/show.blade.php",
      },
      {
        name: "welcome",
        path: `${ROOT}/views/welcome.blade.php`,
        relativePath: "views/welcome.blade.php",
      },
    ]);
  });

  it("keeps the first-seen target for a duplicate dedup key", async () => {
    const { deps } = createDeps({
      readWorkspaceDirectory: async (path) =>
        path === `${ROOT}/views`
          ? [
              fileEntry(`${ROOT}/views/home.blade.php`),
              fileEntry(`${ROOT}/views/home.blade.php`),
            ]
          : [],
    });

    const collect = createWorkspaceTargetCollector<FakeViewTarget>(deps, {
      kind: "directoryScan",
      isEnabled: () => true,
      roots: ["views"],
      recursive: true,
      parseEntry: parseView,
      dedupKey: (target) => target.name.toLowerCase(),
      compareTargets: (left, right) => left.name.localeCompare(right.name),
    });

    expect(await collect({ workspaceRoot: ROOT })).toEqual([
      {
        name: "home",
        path: `${ROOT}/views/home.blade.php`,
        relativePath: "views/home.blade.php",
      },
    ]);
  });

  it("records a file-level target before reading and keeps it when the read fails", async () => {
    const readWorkspaceDirectory = vi.fn(async (path: string) =>
      path === `${ROOT}/config`
        ? [
            fileEntry(`${ROOT}/config/app.php`),
            fileEntry(`${ROOT}/config/broken.php`),
            fileEntry(`${ROOT}/config/ignored.txt`),
          ]
        : [],
    );
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/config/app.php`) {
        return "app.name\napp.url";
      }
      throw new Error("read failed");
    });
    const { deps } = createDeps({
      readWorkspaceDirectory,
      readFileContent,
    });

    const collect = createWorkspaceTargetCollector<FakeConfigTarget>(deps, {
      kind: "directoryScan",
      isEnabled: () => true,
      roots: ["config"],
      readsContent: true,
      parseEntry: parseConfig,
      dedupKey: (target) => target.key.toLowerCase(),
      compareTargets: (left, right) => left.key.localeCompare(right.key),
    });

    const targets = await collect({ workspaceRoot: ROOT });

    // The unrelated `.txt` file is never read (the metadata pass rejected it).
    expect(readFileContent).not.toHaveBeenCalledWith(
      `${ROOT}/config/ignored.txt`,
    );
    expect(readFileContent).toHaveBeenCalledWith(`${ROOT}/config/app.php`);
    expect(readFileContent).toHaveBeenCalledWith(`${ROOT}/config/broken.php`);
    expect(targets.map((target) => target.key)).toEqual([
      "app",
      "app.name",
      "app.url",
      // broken.php could not be read, but its file-level target survives.
      "broken",
    ]);
  });

  it("serves cached targets without rescanning and rescans after invalidation", async () => {
    const store = new Map<string, FakeViewTarget[]>();
    const cache: WorkspaceTargetCache<FakeViewTarget> = {
      read: (root) => store.get(root) ?? null,
      write: (root, targets) => {
        store.set(root, targets);
      },
    };
    const readWorkspaceDirectory = vi.fn(async (path: string) =>
      path === `${ROOT}/views` ? [fileEntry(`${ROOT}/views/home.blade.php`)] : [],
    );
    const { deps } = createDeps({ readWorkspaceDirectory });

    const collect = createWorkspaceTargetCollector<FakeViewTarget>(deps, {
      kind: "directoryScan",
      isEnabled: () => true,
      roots: ["views"],
      recursive: true,
      parseEntry: parseView,
      dedupKey: (target) => target.name.toLowerCase(),
      compareTargets: (left, right) => left.name.localeCompare(right.name),
      cache,
    });

    const first = await collect({ workspaceRoot: ROOT });
    expect(first.map((target) => target.name)).toEqual(["home"]);
    expect(readWorkspaceDirectory).toHaveBeenCalledTimes(1);

    // Cache hit: no rescan.
    const second = await collect({ workspaceRoot: ROOT });
    expect(second.map((target) => target.name)).toEqual(["home"]);
    expect(readWorkspaceDirectory).toHaveBeenCalledTimes(1);

    // Invalidate the cache: the next call rescans.
    store.clear();
    const third = await collect({ workspaceRoot: ROOT });
    expect(third.map((target) => target.name)).toEqual(["home"]);
    expect(readWorkspaceDirectory).toHaveBeenCalledTimes(2);
  });

  it("keeps cache entries isolated per workspace root", async () => {
    const OTHER = "/other";
    const store = new Map<string, FakeViewTarget[]>();
    const cache: WorkspaceTargetCache<FakeViewTarget> = {
      read: (root) => store.get(root) ?? null,
      write: (root, targets) => {
        store.set(root, targets);
      },
    };
    const ref: { current: string | null } = { current: ROOT };
    const readWorkspaceDirectory = vi.fn(async (path: string) => {
      if (path === `${ROOT}/views`) {
        return [fileEntry(`${ROOT}/views/a.blade.php`)];
      }
      if (path === `${OTHER}/views`) {
        return [fileEntry(`${OTHER}/views/b.blade.php`)];
      }
      return [];
    });
    const deps: WorkspaceTargetCollectorDeps = {
      currentWorkspaceRootRef: ref,
      textSearch: { searchText: vi.fn() as never },
      readFileContent: vi.fn() as never,
      readWorkspaceDirectory: readWorkspaceDirectory as never,
      relativeWorkspacePath,
      joinWorkspacePath,
      isPhpPath,
    };

    const collect = createWorkspaceTargetCollector<FakeViewTarget>(deps, {
      kind: "directoryScan",
      isEnabled: () => true,
      roots: ["views"],
      recursive: true,
      parseEntry: parseView,
      dedupKey: (target) => target.name.toLowerCase(),
      compareTargets: (left, right) => left.name.localeCompare(right.name),
      cache,
    });

    const fromRoot = await collect({ workspaceRoot: ROOT });
    expect(fromRoot.map((target) => target.name)).toEqual(["a"]);

    ref.current = OTHER;
    const fromOther = await collect({ workspaceRoot: OTHER });
    expect(fromOther.map((target) => target.name)).toEqual(["b"]);

    // Each root keeps its own cache; neither served the other's targets.
    expect(store.get(ROOT)?.map((target) => target.name)).toEqual(["a"]);
    expect(store.get(OTHER)?.map((target) => target.name)).toEqual(["b"]);
  });

  it("caches an empty result when a directory read fails by default", async () => {
    const store = new Map<string, FakeViewTarget[]>();
    const cache: WorkspaceTargetCache<FakeViewTarget> = {
      read: (root) => store.get(root) ?? null,
      write: (root, targets) => {
        store.set(root, targets);
      },
    };
    const { deps } = createDeps({
      readWorkspaceDirectory: async () => {
        throw new Error("missing directory");
      },
    });

    const collect = createWorkspaceTargetCollector<FakeViewTarget>(deps, {
      kind: "directoryScan",
      isEnabled: () => true,
      roots: ["views"],
      recursive: true,
      parseEntry: parseView,
      dedupKey: (target) => target.name.toLowerCase(),
      compareTargets: (left, right) => left.name.localeCompare(right.name),
      cache,
    });

    expect(await collect({ workspaceRoot: ROOT })).toEqual([]);
    expect(store.get(ROOT)).toEqual([]);
  });

  it("skips the cache write on a directory read failure when asked to rescan", async () => {
    const store = new Map<string, FakeConfigTarget[]>();
    const cache: WorkspaceTargetCache<FakeConfigTarget> = {
      read: (root) => store.get(root) ?? null,
      write: (root, targets) => {
        store.set(root, targets);
      },
    };
    const { deps } = createDeps({
      readWorkspaceDirectory: async () => {
        throw new Error("missing directory");
      },
    });

    const collect = createWorkspaceTargetCollector<FakeConfigTarget>(deps, {
      kind: "directoryScan",
      isEnabled: () => true,
      roots: ["config"],
      readsContent: true,
      rescanAfterDirectoryReadFailure: true,
      parseEntry: parseConfig,
      dedupKey: (target) => target.key.toLowerCase(),
      compareTargets: (left, right) => left.key.localeCompare(right.key),
      cache,
    });

    expect(await collect({ workspaceRoot: ROOT })).toEqual([]);
    expect(store.has(ROOT)).toBe(false);
  });

  it("returns empty without scanning when disabled or root is null", async () => {
    const disabled = createDeps();
    const collectDisabled = createWorkspaceTargetCollector<FakeViewTarget>(
      disabled.deps,
      {
        kind: "directoryScan",
        isEnabled: () => false,
        roots: ["views"],
        recursive: true,
        parseEntry: parseView,
        dedupKey: (target) => target.name.toLowerCase(),
        compareTargets: (left, right) => left.name.localeCompare(right.name),
      },
    );
    expect(await collectDisabled({ workspaceRoot: ROOT })).toEqual([]);
    expect(disabled.readWorkspaceDirectory).not.toHaveBeenCalled();

    const noRoot = createDeps();
    const collectNoRoot = createWorkspaceTargetCollector<FakeViewTarget>(
      noRoot.deps,
      {
        kind: "directoryScan",
        isEnabled: () => true,
        roots: ["views"],
        recursive: true,
        parseEntry: parseView,
        dedupKey: (target) => target.name.toLowerCase(),
        compareTargets: (left, right) => left.name.localeCompare(right.name),
      },
    );
    expect(await collectNoRoot({ workspaceRoot: null })).toEqual([]);
    expect(noRoot.readWorkspaceDirectory).not.toHaveBeenCalled();
  });

  it("drops results when the workspace root changes during the scan", async () => {
    const deferred = createDeferred<FileEntry[]>();
    const { deps, ref } = createDeps({
      readWorkspaceDirectory: () => deferred.promise,
    });

    const collect = createWorkspaceTargetCollector<FakeViewTarget>(deps, {
      kind: "directoryScan",
      isEnabled: () => true,
      roots: ["views"],
      recursive: true,
      parseEntry: parseView,
      dedupKey: (target) => target.name.toLowerCase(),
      compareTargets: (left, right) => left.name.localeCompare(right.name),
    });

    const pending = collect({ workspaceRoot: ROOT });

    ref.current = "/other";
    deferred.resolve([fileEntry(`${ROOT}/views/leaked.blade.php`)]);

    expect(await pending).toEqual([]);
  });
});
