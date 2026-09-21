import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkChangedFormat } from "./check-changed-format.mjs";

const workflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/macos-release.yml", import.meta.url)),
  "utf8",
);
const workspaces = [];

function job(name, source = workflow) {
  const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m").exec(
    source,
  );
  expect(match, `missing workflow job ${name}`).not.toBeNull();
  return match[1];
}

function formatScript() {
  const frontend = readFileSync(
    fileURLToPath(new URL("../.github/workflows/frontend-ci.yml", import.meta.url)),
    "utf8",
  );
  const match = /- name: Check formatting[\s\S]*?run: \|\n((?: {10}.+\n)+)/.exec(frontend);
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
  it("waits for every reusable quality workflow before building or publishing", () => {
    expect(job("frontend-checks")).toContain("uses: ./.github/workflows/frontend-ci.yml");
    expect(job("rust-checks")).toContain("uses: ./.github/workflows/rust-ci.yml");
    expect(job("frontend-checks")).toContain("release: true");
    for (const name of ["release-build", "smoke-dmg"]) {
      expect(job(name)).toMatch(/needs:\s*\[validate-dispatch, frontend-checks, rust-checks\]/);
      expect(job(name)).not.toMatch(/^    if:.*always\(\)|continue-on-error:\s*true/m);
    }
    expect(job("publish-release")).toMatch(/needs:\s*release-build\n/);
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  });

  it("keeps every parallel check and shard mandatory, including aggregate coverage and doctests", () => {
    const readWorkflow = (name) =>
      readFileSync(
        fileURLToPath(new URL(`../.github/workflows/${name}.yml`, import.meta.url)),
        "utf8",
      );
    const frontend = readWorkflow("frontend-ci");
    const rust = readWorkflow("rust-ci");
    for (const source of [frontend, rust]) {
      expect(source).not.toMatch(/continue-on-error:|max-parallel:|fail-fast: true/);
      expect(job("tests", source)).toContain("shard: [1, 2, 3, 4]");
      expect(job("checks", source)).not.toMatch(/^    needs:/m);
    }
    expect(job("tests", frontend)).not.toMatch(/^    needs:/m);
    expect(job("tests", rust)).toMatch(/needs: test-build/);
    expect(job("test-build", rust)).not.toMatch(/^    needs:/m);
    expect(job("checks", frontend)).toContain(
      "check: [formatting, lint, hooks, hotspots, types, build]",
    );
    for (const command of [
      "format:check",
      "format:check:changed",
      "lint -- --max-warnings 0",
      "lint:exhaustive-deps",
      "size:hotspots",
      "check",
      "build",
    ]) {
      expect(job("checks", frontend)).toContain(`npm run ${command}`);
    }
    expect(job("tests", frontend)).toContain("--shard=${{ matrix.shard }}/4");
    const coverage = job("coverage", frontend);
    expect(coverage).toMatch(/needs: tests/);
    expect(coverage).toContain("npm run test:coverage -- --merge-reports=.vitest-reports");
    expect(coverage).not.toContain("thresholds.");
    expect(coverage).toContain("for shard in 1 2 3 4");
    expect(job("checks", rust)).toContain("check: [format, clippy, compile, doctests]");
    expect(job("checks", rust)).toContain(
      "cargo test --manifest-path src-tauri/Cargo.toml --locked --doc",
    );
    expect(job("tests", rust)).toContain("tool: cargo-nextest@0.9.145");
    expect(job("tests", rust)).toContain('--partition "slice:$SHARD/4"');
    expect(job("test-build", rust)).toContain("cargo nextest archive");
    expect(job("tests", rust)).toContain(
      "artifact-ids: ${{ needs.test-build.outputs.artifact-id }}",
    );
    expect(job("tests", rust)).toContain("ARCHIVE_SHA256: ${{ needs.test-build.outputs.sha256 }}");
    expect(job("tests", rust)).toContain("shasum -a 256 -c -");
    expect(job("tests", rust)).toContain("cargo-nextest nextest run");
    expect(job("tests", rust)).toContain(
      '--archive-file "$RUNNER_TEMP/rust-test-archive/tests.tar.zst"',
    );
    expect(job("tests", rust)).not.toMatch(/cargo (test|build|nextest)|rustup/);
    expect(rust).not.toMatch(/rust-cache|actions\/cache|save-cache|restore-cache/);
  });

  it("rejects a mismatched Rust archive or compile-time workspace before tests run", () => {
    const rust = readFileSync(
      fileURLToPath(new URL("../.github/workflows/rust-ci.yml", import.meta.url)),
      "utf8",
    );
    const verification = job("tests", rust)
      .split("- name: Verify archive and compile-time source path")[1]
      .split("- name: Run Rust test shard")[0];
    const script = /run: \|\n([\s\S]*)/.exec(verification)[1].replace(/^ {10}/gm, "");
    const directory = mkdtempSync(path.join(os.tmpdir(), "codevo-rust-archive-"));
    workspaces.push(directory);
    mkdirSync(path.join(directory, "rust-test-archive"));
    const archive = "fixture test archive";
    writeFileSync(path.join(directory, "rust-test-archive/tests.tar.zst"), archive);
    const digest = createHash("sha256").update(archive).digest("hex");
    for (const [sha256, workspace, expected] of [
      [digest, `${directory}/src-tauri`, 0],
      ["0".repeat(64), `${directory}/src-tauri`, 1],
      [digest, "/foreign/src-tauri", 1],
      ["", `${directory}/src-tauri`, 1],
    ]) {
      const result = spawnSync("bash", ["-e", "-u", "-o", "pipefail", "-c", script], {
        env: {
          ...process.env,
          ARCHIVE_SHA256: sha256,
          BUILD_WORKSPACE: workspace,
          GITHUB_WORKSPACE: directory,
          RUNNER_TEMP: directory,
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status === 0, result.stderr).toBe(expected === 0);
    }
  });

  it("ad-hoc signs beta and smoke bundles during packaging and keeps Developer ID signing separate", () => {
    const release = job("release-build");
    const beta = release.split("- name: Build unsigned beta artifacts")[1].split("- name:")[0];
    const signed = release.split("- name: Build signed release artifacts")[1].split("- name:")[0];
    expect(beta).toContain('APPLE_SIGNING_IDENTITY: "-"');
    expect(beta).toContain("npm run tauri build -- --bundles app,dmg");
    expect(beta).not.toContain("hardenedRuntime");
    expect(signed).toContain("run: npm run tauri build -- --bundles app,dmg");
    expect(signed).not.toContain("hardenedRuntime");
    expect(signed).not.toContain("--config");
    expect(signed).toContain("APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}");
    const smoke = job("smoke-dmg");
    expect(smoke).toContain('APPLE_SIGNING_IDENTITY: "-"');
    expect(smoke).toContain('--config \'{"bundle":{"createUpdaterArtifacts":false}}\'');
    expect(smoke).not.toContain("hardenedRuntime");
    expect(smoke.indexOf("APPLE_SIGNING_IDENTITY:")).toBeLessThan(
      smoke.indexOf("npm run tauri build"),
    );
    expect(smoke).toContain('codesign --verify --deep --strict --verbose=2 "${app_paths[0]}"');
    expect(release.indexOf("Build unsigned beta artifacts")).toBeLessThan(
      release.indexOf("Verify release artifacts"),
    );
    expect(release.indexOf("Verify release artifacts")).toBeLessThan(
      release.indexOf("Upload release build"),
    );
  });

  it.each(["false", "true"])(
    "verifies the actual app, updater and DMG bundles with Apple signing=%s",
    (appleSigning) => {
      const result = verifyBundleSeals(appleSigning);
      expect(result.status).toBe(0);
      expect(result.calls.filter((line) => line.startsWith("codesign --verify"))).toHaveLength(3);
      expect(result.calls.some((line) => line.includes("/updater/Codevo Editor.app"))).toBe(true);
      expect(result.calls.some((line) => line.includes("/dmg/Codevo Editor.app"))).toBe(true);
      expect(result.calls.some((line) => line.startsWith("spctl "))).toBe(appleSigning === "true");
      expect(result.calls.some((line) => line.startsWith("xcrun stapler"))).toBe(
        appleSigning === "true",
      );
      expect(result.calls.at(-1)).toBe("verified");
    },
  );

  it.each(["app", "updater", "dmg"])(
    "rejects a broken %s bundle before publishing unsigned artifacts",
    (failure) => {
      const result = verifyBundleSeals("false", failure);
      expect(result.status).not.toBe(0);
      expect(result.calls).not.toContain("verified");
      if (failure === "dmg") {
        expect(result.calls.some((line) => line.startsWith("hdiutil detach"))).toBe(true);
      }
    },
  );

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
      [
        "-e",
        "-u",
        "-o",
        "pipefail",
        "-c",
        `npm() { if [ "$2" = "format:check:changed" ]; then printf '%s\\n' "$@"; fi; }\nIS_RELEASE=true\nFORMAT_BASE_SHA=\n${formatScript()}`,
      ],
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

function verifyBundleSeals(appleSigning, failure = "") {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codevo-bundle-seals-"));
  workspaces.push(directory);
  const app = path.join(directory, "Codevo Editor.app");
  mkdirSync(app);
  const archive = path.join(directory, "updater.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", directory, "Codevo Editor.app"]);
  const verification = job("release-build")
    .split("# Every distribution needs")[1]
    .split('          hdiutil imageinfo "$dmg_path"')[0];
  expect(verification).toBeDefined();
  const script = `
    codesign() {
      printf 'codesign %s\n' "$*" >> "$CALLS"
      if [ "$1" != "--verify" ]; then return 0; fi
      case "$FAILURE:$*" in
        app:*"$app_path"|updater:*"/updater/"*|dmg:*"/dmg/"*) return 1 ;;
      esac
    }
    hdiutil() {
      printf 'hdiutil %s\n' "$*" >> "$CALLS"
      if [ "$1" = attach ]; then
        mkdir "$dmg_mount/Codevo Editor.app"
        touch "$RUNNER_TEMP/mounted"
      elif [ "$1" = detach ]; then
        rm -f "$RUNNER_TEMP/mounted"
      fi
    }
    mount() {
      if [ -f "$RUNNER_TEMP/mounted" ]; then printf 'disk on %s (hfs)\n' "$dmg_mount"; fi
    }
    spctl() { printf 'spctl %s\n' "$*" >> "$CALLS"; }
    xcrun() { printf 'xcrun %s\n' "$*" >> "$CALLS"; }
    # Every distribution needs${verification}
    printf 'verified\n' >> "$CALLS"
  `;
  const calls = path.join(directory, "calls");
  let status = 0;
  try {
    execFileSync("bash", ["-e", "-u", "-o", "pipefail", "-c", script], {
      env: {
        ...process.env,
        RUNNER_TEMP: directory,
        CALLS: calls,
        FAILURE: failure,
        APPLE_SIGNING: appleSigning,
        app_path: app,
        updater_path: archive,
        dmg_path: "fixture.dmg",
      },
      timeout: 10_000,
      stdio: "pipe",
    });
  } catch (error) {
    status = error.status;
  }
  return { status, calls: readFileSync(calls, "utf8").trim().split("\n") };
}
