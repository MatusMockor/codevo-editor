import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalFixtureDigest,
  computeFixtureHashes,
  computeFixtureManifest,
  fixtureHashFenceFailure,
} from "./fixtureHash.mjs";

const perfDirectory = path.dirname(fileURLToPath(import.meta.url));
const scratchRoot = path.join(perfDirectory, "__testtmp__");

let rootDir = "";

function writeFixture(relativePath, contents) {
  const absolutePath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function sha256Of(contents) {
  return createHash("sha256").update(Buffer.from(contents, "utf8")).digest("hex");
}

beforeEach(() => {
  rootDir = path.join(scratchRoot, `fixtureHash-${randomUUID()}`);
  mkdirSync(rootDir, { recursive: true });
});

describe("fixtureHashFenceFailure", () => {
  it("accepts the same hash map independent of key insertion order", () => {
    expect(fixtureHashFenceFailure({ a: "one", b: "two" }, { b: "two", a: "one" })).toBeNull();
  });

  it.each([
    [{ a: "one" }, { a: "changed" }],
    [{ a: "one" }, { a: "one", b: "two" }],
    [{ a: "one", b: "two" }, { a: "one" }],
  ])("fails closed when fixture identity changes during a run", (before, after) => {
    expect(fixtureHashFenceFailure(before, after)).toMatch(/run is invalid/);
  });
});

afterEach(() => {
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe("computeFixtureHashes", () => {
  it("hashes every file content with sha256 keyed by repo-relative path", () => {
    writeFixture("medium-2k.ts", "export const alpha = 1;\n");

    expect(computeFixtureHashes(rootDir)).toEqual({
      "medium-2k.ts": sha256Of("export const alpha = 1;\n"),
    });
  });

  it("walks nested directories and joins segments with forward slashes", () => {
    writeFixture("packages/pkg-01/src/index.ts", "a");
    writeFixture("packages/pkg-01/src/extra/file-001.ts", "b");
    writeFixture("root.ts", "c");

    expect(Object.keys(computeFixtureHashes(rootDir))).toEqual([
      "packages/pkg-01/src/extra/file-001.ts",
      "packages/pkg-01/src/index.ts",
      "root.ts",
    ]);
  });

  it("orders keys deterministically regardless of file creation order", () => {
    writeFixture("zeta.ts", "z");
    writeFixture("alpha.ts", "a");
    writeFixture("nested/beta.ts", "b");
    writeFixture("nested/aardvark.ts", "aa");

    const first = Object.keys(computeFixtureHashes(rootDir));
    const second = Object.keys(computeFixtureHashes(rootDir));

    expect(first).toEqual(second);
    expect(first).toEqual([...first].sort());
  });

  it("returns a byte-identical map for two runs over unchanged content", () => {
    writeFixture("large-files/medium-2k.ts", 'export type AlphaKind = "a";\n');
    writeFixture("monorepo/package.json", "{}\n");

    expect(computeFixtureHashes(rootDir)).toEqual(computeFixtureHashes(rootDir));
  });

  it("changes only the hash of the file whose content changed", () => {
    writeFixture("stable.ts", "stable");
    writeFixture("mutated.ts", "before");
    const before = computeFixtureHashes(rootDir);

    writeFixture("mutated.ts", "after");
    const after = computeFixtureHashes(rootDir);

    expect(after["stable.ts"]).toBe(before["stable.ts"]);
    expect(after["mutated.ts"]).not.toBe(before["mutated.ts"]);
    expect(after["mutated.ts"]).toBe(sha256Of("after"));
  });

  it("distinguishes a whitespace-only edit", () => {
    writeFixture("spaced.ts", "const a = 1;");
    const before = computeFixtureHashes(rootDir);

    writeFixture("spaced.ts", "const a = 1;\n");

    expect(computeFixtureHashes(rootDir)["spaced.ts"]).not.toBe(before["spaced.ts"]);
  });

  it("reports an empty map for an empty fixture root", () => {
    expect(computeFixtureHashes(rootDir)).toEqual({});
  });

  it("hashes a __proto__ fixture as an ordinary own key", () => {
    writeFixture("__proto__", "p");

    const hashes = computeFixtureHashes(rootDir);

    expect(Object.keys(hashes)).toEqual(["__proto__"]);
    expect(hashes["__proto__"]).toBe(sha256Of("p"));
  });

  it("treats a file moved between directories as a different key", () => {
    writeFixture("a/shared.ts", "same");
    const before = computeFixtureHashes(rootDir);

    rmSync(path.join(rootDir, "a"), { force: true, recursive: true });
    writeFixture("b/shared.ts", "same");
    const after = computeFixtureHashes(rootDir);

    expect(Object.keys(before)).toEqual(["a/shared.ts"]);
    expect(Object.keys(after)).toEqual(["b/shared.ts"]);
    expect(after["b/shared.ts"]).toBe(before["a/shared.ts"]);
  });

  it("rejects symbolic links instead of following them", () => {
    writeFixture("outside.ts", "outside");
    symlinkSync(path.join(rootDir, "outside.ts"), path.join(rootDir, "alias.ts"));

    expect(() => computeFixtureHashes(rootDir)).toThrow(/symbolic link/);
  });

  it.each([
    ["maxFiles", { maxFiles: 1 }, ["a.ts", "b.ts"]],
    ["maxTotalBytes", { maxTotalBytes: 1 }, ["a.ts"]],
    ["maxFileBytes", { maxFileBytes: 1 }, ["a.ts"]],
    ["maxRelativePathBytes", { maxRelativePathBytes: 3 }, ["long.ts"]],
  ])("fails closed at the %s bound", (name, limits, files) => {
    for (const file of files) writeFixture(file, "ab");

    expect(() => computeFixtureHashes(rootDir, { limits })).toThrow(name);
  });

  it("fails closed at the recursion depth bound", () => {
    writeFixture("one/two/file.ts", "content");

    expect(() => computeFixtureHashes(rootDir, { limits: { maxDepth: 1 } })).toThrow(/maxDepth/);
  });

  it("uses a canonical aggregate independent of object insertion order", () => {
    expect(canonicalFixtureDigest({ a: "one", b: "two" })).toBe(
      canonicalFixtureDigest({ b: "two", a: "one" }),
    );
  });

  it("orders canonically equivalent Unicode paths by deterministic UTF-8 bytes", () => {
    const composed = "é.ts";
    const decomposed = "e\u0301.ts";

    expect(canonicalFixtureDigest({ [composed]: "a", [decomposed]: "b" })).toBe(
      canonicalFixtureDigest({ [decomposed]: "b", [composed]: "a" }),
    );
  });

  it("includes empty directories in the canonical manifest digest", () => {
    const before = computeFixtureManifest(rootDir);
    mkdirSync(path.join(rootDir, "empty"));
    const after = computeFixtureManifest(rootDir);

    expect(after.directories).toEqual(["empty"]);
    expect(after.directoryCount).toBe(1);
    expect(after.aggregateDigest).not.toBe(before.aggregateDigest);
  });

  it.each([
    ["maxEntries", { maxEntries: 1 }],
    ["maxEntriesPerDirectory", { maxEntriesPerDirectory: 1 }],
    ["maxDirectories", { maxDirectories: 1 }],
  ])("bounds directory traversal with %s", (name, limits) => {
    mkdirSync(path.join(rootDir, "one"));
    mkdirSync(path.join(rootDir, "two"));

    expect(() => computeFixtureManifest(rootDir, { limits })).toThrow(name);
  });

  it("reports bounded aggregate metadata without an absolute path", () => {
    writeFixture("src/index.ts", "export {};\n");

    const manifest = computeFixtureManifest(rootDir);

    expect(manifest).toMatchObject({ algorithm: "sha256", fileCount: 1, totalBytes: 11 });
    expect(manifest.aggregateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain(rootDir);
  });
});
