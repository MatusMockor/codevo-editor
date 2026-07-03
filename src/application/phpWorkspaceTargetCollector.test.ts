import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceTargetCollector,
  type WorkspaceTargetCollectorDeps,
  type WorkspaceTargetDefinition,
} from "./phpWorkspaceTargetCollector";
import type { TextSearchResult } from "../domain/workspace";

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
}

function createDeps(
  overrides: {
    searchText?: (root: string, query: string) => Promise<TextSearchResult[]>;
    readFileContent?: (path: string) => Promise<string>;
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

  const deps: WorkspaceTargetCollectorDeps = {
    currentWorkspaceRootRef: ref,
    textSearch: { searchText: searchText as never },
    readFileContent: readFileContent as never,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
  };

  return { deps, ref, searchText, readFileContent };
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
