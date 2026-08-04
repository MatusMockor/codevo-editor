import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeFixtureHashes } from "./fixtureHash.mjs";

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
});
