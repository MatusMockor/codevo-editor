import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkChangedFormat } from "./check-changed-format.mjs";

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/macos-release.yml", import.meta.url)),
  "utf8",
);
const workspaces = [];

function job(name) {
  const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m").exec(
    workflow,
  );
  expect(match, `missing workflow job ${name}`).not.toBeNull();
  return match[1];
}

function formatScript() {
  const match = /- name: Check release TypeScript formatting\n {8}run: \|\n((?: {10}.+\n)+)/.exec(
    job("frontend-checks"),
  );
  expect(match).not.toBeNull();
  return match[1].replace(/^ {10}/gm, "");
}

function git(directory, ...args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

afterEach(() => {
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("release quality gates", () => {
  it("requires hook, formatting, lint and size checks before release builds", () => {
    const frontend = job("frontend-checks");
    for (const command of [
      "npm run format:check",
      "npm run lint -- --max-warnings 0",
      "npm run lint:exhaustive-deps",
      "npm run size:hotspots",
      "npm run check",
      "npm test",
      "npm run build",
    ]) {
      expect(frontend).toContain(`run: ${command}\n`);
    }
    expect(frontend).not.toMatch(/continue-on-error:\s*true/);
    expect(frontend).toMatch(/uses: actions\/checkout@[^\n]+\n\s+with:\n\s+fetch-depth: 0\n/);
    expect(job("release-build")).toMatch(/needs:\s*\[frontend-checks, rust-checks\]/);
    expect(job("smoke-dmg")).toMatch(/needs:\s*\[frontend-checks, rust-checks\]/);
    expect(job("publish-release")).toMatch(/needs:\s*release-build\n/);
  });

  it("checks intermediate commits since the previous version tag and ignores the moving beta tag", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "codevo-release-gates-"));
    workspaces.push(directory);
    git(directory, "init", "--quiet");
    git(directory, "config", "user.name", "Release test");
    git(directory, "config", "user.email", "release-test@example.invalid");
    git(directory, "config", "commit.gpgsign", "false");
    function commit(file, contents) {
      writeFileSync(path.join(directory, file), contents);
      git(directory, "add", "--", file);
      git(directory, "commit", "--quiet", "-m", file);
    }
    commit("existing.ts", "export const existing = true;\n");
    git(directory, "tag", "v0.2.0-beta.38");
    commit("missed.ts", "export const missed={a:1,b:2}\n");
    commit("intermediate.ts", "export const intermediate = true;\n");
    git(directory, "tag", "beta");
    commit("release.ts", "export const release = true;\n");
    git(directory, "tag", "v0.2.0-beta.39");

    // Run the actual workflow shell, replacing only the external npm invocation.
    const args = execFileSync(
      "bash",
      ["-e", "-u", "-o", "pipefail", "-c", `npm() { printf '%s\\n' "$@"; }\n${formatScript()}`],
      { cwd: directory, encoding: "utf8", timeout: 10_000 },
    )
      .trim()
      .split("\n");
    expect(args).toEqual(["run", "format:check:changed", "--", "v0.2.0-beta.38"]);
    const result = await checkChangedFormat({ cwd: directory, base: args[3] });
    expect(result.failures).toContain("missed.ts");
    const previousCommitOnly = await checkChangedFormat({ cwd: directory, base: "HEAD^" });
    expect(previousCommitOnly.failures).toEqual([]);
  });
});
