import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupPerfFixtureSnapshot,
  createPerfFixtureSnapshot,
  PERF_FIXTURE_EXCLUDED_DIRECTORIES,
  verifyPerfFixtureSnapshot,
} from "./perfFixtureSnapshot.mjs";

let scratchRoot = "";
let sourceRoot = "";

function writeFixture(relativePath, contents) {
  const absolutePath = path.join(sourceRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

beforeEach(() => {
  scratchRoot = path.join(os.tmpdir(), `codevo-perf-snapshot-test-${randomUUID()}`);
  sourceRoot = path.join(scratchRoot, "synthetic-fixture");
  mkdirSync(sourceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe("perf fixture snapshot", () => {
  it("copies only regular synthetic fixture files into an owned temporary root", () => {
    writeFixture("large-files/large.ts", "export const large = true;\n");
    writeFixture("monorepo/packages/a/index.ts", "export {};\n");

    const snapshot = createPerfFixtureSnapshot(sourceRoot, { temporaryParent: scratchRoot });

    expect(readFileSync(path.join(snapshot.fixtureRoot, "large-files/large.ts"), "utf8")).toBe(
      "export const large = true;\n",
    );
    expect(snapshot.ownedRoot).toMatch(/codevo-perf-fixture-/);
    expect(snapshot.fixtureRoot).toBe(path.join(snapshot.workRoot, "perf", "fixtures"));
    expect(verifyPerfFixtureSnapshot(snapshot).failure).toBeNull();
    expect(JSON.stringify(snapshot.metadata)).not.toContain(scratchRoot);

    cleanupPerfFixtureSnapshot(snapshot);
    expect(existsSync(snapshot.ownedRoot)).toBe(false);
  });

  it("copies a fixture named __proto__ and includes it in the digest", () => {
    writeFixture("__proto__", "prototype fixture");

    const snapshot = createPerfFixtureSnapshot(sourceRoot, { temporaryParent: scratchRoot });

    expect(readFileSync(path.join(snapshot.fixtureRoot, "__proto__"), "utf8")).toBe(
      "prototype fixture",
    );
    expect(snapshot.metadata.fileCount).toBe(1);
    expect(verifyPerfFixtureSnapshot(snapshot).metadata.digest).toBe(snapshot.metadata.digest);
    cleanupPerfFixtureSnapshot(snapshot);
  });

  it("preserves bounded empty directories as part of fixture identity", () => {
    mkdirSync(path.join(sourceRoot, "packages/empty"), { recursive: true });

    const snapshot = createPerfFixtureSnapshot(sourceRoot, { temporaryParent: scratchRoot });

    expect(existsSync(path.join(snapshot.fixtureRoot, "packages/empty"))).toBe(true);
    expect(snapshot.metadata.directoryCount).toBe(2);
    expect(verifyPerfFixtureSnapshot(snapshot).failure).toBeNull();
    cleanupPerfFixtureSnapshot(snapshot);
  });

  it.each(PERF_FIXTURE_EXCLUDED_DIRECTORIES)(
    "does not copy the closed excluded directory %s",
    (directory) => {
      writeFixture("kept.ts", "kept");
      writeFixture(`${directory}/ignored.ts`, "ignored");

      const snapshot = createPerfFixtureSnapshot(sourceRoot, { temporaryParent: scratchRoot });

      expect(existsSync(path.join(snapshot.fixtureRoot, directory))).toBe(false);
      expect(snapshot.metadata.fileCount).toBe(1);
      cleanupPerfFixtureSnapshot(snapshot);
    },
  );

  it("rejects a symlink anywhere in the included fixture tree", () => {
    writeFixture("real.ts", "content");
    symlinkSync(path.join(sourceRoot, "real.ts"), path.join(sourceRoot, "alias.ts"));

    expect(() => createPerfFixtureSnapshot(sourceRoot, { temporaryParent: scratchRoot })).toThrow(
      /symbolic link/,
    );
  });

  it("reports post-snapshot mutation through the aggregate digest fence", () => {
    writeFixture("src/index.ts", "before");
    const snapshot = createPerfFixtureSnapshot(sourceRoot, { temporaryParent: scratchRoot });
    writeFileSync(path.join(snapshot.fixtureRoot, "src/index.ts"), "after", "utf8");

    expect(verifyPerfFixtureSnapshot(snapshot).failure).toMatch(/run is invalid/);
    cleanupPerfFixtureSnapshot(snapshot);
  });

  it("enforces the configured copy bounds before creating a snapshot root", () => {
    writeFixture("large.ts", "too large");

    expect(() =>
      createPerfFixtureSnapshot(sourceRoot, {
        temporaryParent: scratchRoot,
        limits: { maxFileBytes: 2 },
      }),
    ).toThrow(/maxFileBytes/);
    expect(
      readdirSync(scratchRoot).filter((entry) => entry.startsWith("codevo-perf-fixture-")),
    ).toEqual([]);
  });

  it("refuses cleanup when the ownership token does not match", () => {
    writeFixture("index.ts", "content");
    const snapshot = createPerfFixtureSnapshot(sourceRoot, { temporaryParent: scratchRoot });

    expect(() => cleanupPerfFixtureSnapshot({ ...snapshot, ownershipToken: randomUUID() })).toThrow(
      /another run/,
    );
    expect(existsSync(snapshot.ownedRoot)).toBe(true);

    cleanupPerfFixtureSnapshot(snapshot);
  });

  it("refuses cleanup of a lookalike directory without an ownership marker", () => {
    const lookalike = path.join(realpathSync(scratchRoot), `codevo-perf-fixture-${randomUUID()}`);
    mkdirSync(lookalike);
    writeFileSync(path.join(lookalike, "valuable.txt"), "keep", "utf8");

    expect(() =>
      cleanupPerfFixtureSnapshot({
        ownedRoot: lookalike,
        ownershipToken: randomUUID(),
        temporaryParent: scratchRoot,
      }),
    ).toThrow(/replaced snapshot root|ownership marker/);
    expect(readFileSync(path.join(lookalike, "valuable.txt"), "utf8")).toBe("keep");
  });

  it("refuses cleanup when the exact owned root has been replaced", () => {
    writeFixture("index.ts", "content");
    const snapshot = createPerfFixtureSnapshot(sourceRoot, { temporaryParent: scratchRoot });
    const movedRoot = `${snapshot.ownedRoot}-moved`;
    renameSync(snapshot.ownedRoot, movedRoot);
    mkdirSync(snapshot.ownedRoot);
    writeFileSync(path.join(snapshot.ownedRoot, "valuable.txt"), "keep", "utf8");

    expect(() => cleanupPerfFixtureSnapshot(snapshot)).toThrow(/replaced snapshot root/);
    expect(readFileSync(path.join(snapshot.ownedRoot, "valuable.txt"), "utf8")).toBe("keep");

    cleanupPerfFixtureSnapshot({ ...snapshot, ownedRoot: movedRoot });
  });
});
