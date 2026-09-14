import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkChangedFormat } from "./check-changed-format.mjs";

const roots = [];
const clean = "export const value = 1;\n";
const dirty = "export const value=2\n";
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 });
}
async function repo() {
  const cwd = await mkdtemp(join(tmpdir(), "codevo-format-test-"));
  roots.push(cwd);
  git(cwd, "init", "--quiet");
  git(cwd, "config", "user.email", "test@example.invalid");
  git(cwd, "config", "user.name", "Format test");
  await writeFile(join(cwd, "clean.ts"), clean);
  await writeFile(join(cwd, "legacy.ts"), dirty);
  await writeFile(join(cwd, ".gitignore"), "generated/\n");
  await writeFile(join(cwd, ".prettierignore"), "ignored/\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "--quiet", "-m", "baseline");
  const base = git(cwd, "rev-parse", "HEAD").trim();
  git(cwd, "commit", "--quiet", "--allow-empty", "-m", "current");
  return { cwd, base };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("changed-format Git ratchet", () => {
  it("finds unstaged, staged and untracked files before committing", async () => {
    const { cwd } = await repo();
    await writeFile(join(cwd, "clean.ts"), dirty);
    await writeFile(join(cwd, "staged.tsx"), dirty);
    git(cwd, "add", "staged.tsx");
    await writeFile(join(cwd, "new file.ts"), dirty);
    expect((await checkChangedFormat({ cwd })).failures).toEqual([
      "clean.ts",
      "new file.ts",
      "staged.tsx",
      "staged.tsx (staged)",
    ]);
  });

  it("checks index contents even when the worktree has already been formatted", async () => {
    const { cwd } = await repo();
    await writeFile(join(cwd, "clean.ts"), dirty);
    git(cwd, "add", "clean.ts");
    await writeFile(join(cwd, "clean.ts"), clean);
    expect((await checkChangedFormat({ cwd })).failures).toEqual(["clean.ts (staged)"]);
  });

  it("ignores removed files and generated untracked artifacts", async () => {
    const { cwd } = await repo();
    git(cwd, "rm", "--quiet", "clean.ts");
    await rm(join(cwd, "legacy.ts"));
    for (const directory of ["generated", "ignored"]) {
      await mkdir(join(cwd, directory));
      await writeFile(join(cwd, directory, "output.ts"), dirty);
    }
    expect(await checkChangedFormat({ cwd })).toEqual({
      checked: 0,
      failures: [],
      skippedLegacy: [],
    });
  });

  it("preserves legacy rename baselines while rejecting regressions in clean renamed files", async () => {
    const { cwd } = await repo();
    git(cwd, "mv", "legacy.ts", "old name.ts");
    git(cwd, "mv", "clean.ts", "new name.ts");
    await writeFile(join(cwd, "new name.ts"), dirty);
    const result = await checkChangedFormat({ cwd });
    expect(result.failures).toEqual(["new name.ts"]);
    expect(result.skippedLegacy).toEqual(["old name.ts"]);
  });

  it("checks the explicit commit range and local changes together", async () => {
    const { cwd, base } = await repo();
    await writeFile(join(cwd, "committed.ts"), dirty);
    git(cwd, "add", ".");
    git(cwd, "commit", "--quiet", "-m", "first change");
    git(cwd, "commit", "--quiet", "--allow-empty", "-m", "latest change");
    await writeFile(join(cwd, "untracked.ts"), dirty);
    expect((await checkChangedFormat({ cwd, base })).failures).toEqual([
      "committed.ts",
      "untracked.ts",
    ]);
  });

  it("skips legacy formatting without relaxing clean or new files", async () => {
    const { cwd } = await repo();
    await writeFile(join(cwd, "legacy.ts"), "export const value=3\n");
    await writeFile(join(cwd, "clean.ts"), "export const value = 3;\n");
    await writeFile(join(cwd, "new.ts"), clean);
    const result = await checkChangedFormat({ cwd });
    expect(result.failures).toEqual([]);
    expect(result.skippedLegacy).toEqual(["legacy.ts"]);
    expect(result.checked).toBe(3);
  });

  it("handles committed renames followed by another local rename", async () => {
    const { cwd, base } = await repo();
    git(cwd, "mv", "legacy.ts", "middle.ts");
    git(cwd, "commit", "--quiet", "-m", "rename");
    await rename(join(cwd, "middle.ts"), join(cwd, "final.ts"));
    git(cwd, "add", "--all");
    const result = await checkChangedFormat({ cwd, base });
    expect(result.failures).toEqual([]);
    expect(result.skippedLegacy).toEqual(["final.ts"]);
  });

  it("rejects an unresolved explicit base", async () => {
    const { cwd } = await repo();
    await expect(checkChangedFormat({ cwd, base: "missing-base" })).rejects.toThrow(
      "Unable to resolve format-check base commit",
    );
  });
});
