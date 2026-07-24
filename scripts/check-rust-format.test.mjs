import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverRustSources } from "./check-rust-format.mjs";

function withTemporaryTree(run) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "codevo-rust-format-test-"));
  const expectedParent = resolve(tmpdir());
  const resolvedRoot = resolve(temporaryRoot);
  if (
    dirname(resolvedRoot) !== expectedParent ||
    !basename(resolvedRoot).startsWith("codevo-rust-format-test-")
  ) {
    throw new Error("Refusing to use an unexpected Rust format test path.");
  }
  try {
    return run(temporaryRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

describe("Rust format source discovery", () => {
  it("discovers regular Rust sources deterministically, including paths with spaces", () => {
    withTemporaryTree((temporaryRoot) => {
      const sourceRoot = join(temporaryRoot, "src");
      mkdirSync(join(sourceRoot, "nested directory"), { recursive: true });
      writeFileSync(join(sourceRoot, "z.rs"), "pub fn z() {}\n");
      writeFileSync(join(sourceRoot, "nested directory", "a file.rs"), "pub fn a() {}\n");
      writeFileSync(join(sourceRoot, "ignored.txt"), "not Rust\n");

      expect(discoverRustSources(sourceRoot)).toEqual([
        join(sourceRoot, "nested directory", "a file.rs"),
        join(sourceRoot, "z.rs"),
      ]);
    });
  });

  it("rejects a symlinked Rust source without following it", () => {
    withTemporaryTree((temporaryRoot) => {
      const sourceRoot = join(temporaryRoot, "src");
      mkdirSync(sourceRoot);
      const target = join(temporaryRoot, "outside.rs");
      writeFileSync(target, "pub fn outside() {}\n");
      symlinkSync(target, join(sourceRoot, "linked.rs"), "file");

      expect(() => discoverRustSources(sourceRoot)).toThrow(/accept symbolic link linked\.rs/);
    });
  });

  it("rejects a symlinked directory without traversing it", () => {
    withTemporaryTree((temporaryRoot) => {
      const sourceRoot = join(temporaryRoot, "src");
      const target = join(temporaryRoot, "outside");
      mkdirSync(sourceRoot);
      mkdirSync(target);
      writeFileSync(join(target, "outside.rs"), "pub fn outside() {}\n");
      symlinkSync(target, join(sourceRoot, "linked-directory"), "dir");

      expect(() => discoverRustSources(sourceRoot)).toThrow(
        /accept symbolic link linked-directory/,
      );
    });
  });

  it("returns a bounded nonzero CLI diagnostic for a symlink in a mini crate", () => {
    withTemporaryTree((temporaryRoot) => {
      const sourceRoot = join(temporaryRoot, "src-tauri", "src");
      mkdirSync(sourceRoot, { recursive: true });
      writeFileSync(
        join(temporaryRoot, "src-tauri", "Cargo.toml"),
        '[package]\nname = "format-fixture"\nversion = "0.0.0"\nedition = "2021"\n',
      );
      writeFileSync(join(sourceRoot, "lib.rs"), "pub fn formatted() {}\n");
      const target = join(temporaryRoot, "outside.rs");
      writeFileSync(target, "pub fn outside() {}\n");
      symlinkSync(target, join(sourceRoot, "linked.rs"), "file");

      const script = fileURLToPath(new URL("./check-rust-format.mjs", import.meta.url));
      const result = spawnSync(process.execPath, [script], {
        cwd: temporaryRoot,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/accept symbolic link linked\.rs/);
      expect(result.stderr.length).toBeLessThanOrEqual(1024);
    });
  });
});
