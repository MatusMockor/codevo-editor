import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repositoryRoot, ".github/workflows/macos-release.yml");
const RELEASE_VERSION = "0.9.0-beta.30";
const TRUNCATION_BOUNDARY = 4096 - 64;

let metadataScript = "";
let manifestScript = "";
const workspaces = [];

function heredoc(workflow, stepName, nextStepName) {
  const start = workflow.indexOf(`- name: ${stepName}`);
  const end = workflow.indexOf(`- name: ${nextStepName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const match = /node <<'NODE'\n([\s\S]*?)\n {10}NODE/.exec(workflow.slice(start, end));
  expect(match).not.toBeNull();
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

function workspace(changelog) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codevo-release-notes-"));
  workspaces.push(directory);
  writeFileSync(path.join(directory, "CHANGELOG.md"), changelog);
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "codevo-editor", version: RELEASE_VERSION }),
  );
  mkdirSync(path.join(directory, "src-tauri"), { recursive: true });
  writeFileSync(
    path.join(directory, "src-tauri/tauri.conf.json"),
    JSON.stringify({ bundle: { createUpdaterArtifacts: true } }),
  );
  mkdirSync(path.join(directory, "release-assets/publish"), { recursive: true });
  writeFileSync(path.join(directory, "metadata.cjs"), metadataScript);
  writeFileSync(path.join(directory, "manifest.cjs"), manifestScript);
  return directory;
}

function runMetadata(directory) {
  return execFileSync(process.execPath, ["metadata.cjs"], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      EXPECTED_REF: `refs/tags/v${RELEASE_VERSION}`,
      RELEASE_MODE: "beta",
      GITHUB_OUTPUT: path.join(directory, "github-output.txt"),
    },
  });
}

function runManifest(directory) {
  return execFileSync(process.execPath, ["manifest.cjs"], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      SERVER_URL: "https://github.com",
      REPOSITORY: "MatusMockor/codevo-editor",
      RELEASE_TAG: "beta",
      UPDATER_NAME: "Codevo.app.tar.gz",
      UPDATER_SIGNATURE: "fixture-signature",
      RELEASE_ARCH: "ARM64",
      RELEASE_VERSION,
    },
  });
}

function section(version, body) {
  return `## [${version}] - 2026-09-10\n\n${body}\n\n`;
}

function changelogWith(...sections) {
  return `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Nothing yet.\n\n${sections.join("")}`;
}

function releaseNotes(directory) {
  return JSON.parse(readFileSync(path.join(directory, "release-notes.json"), "utf8"));
}

describe("release manifest notes", () => {
  beforeAll(() => {
    const workflow = readFileSync(workflowPath, "utf8");
    metadataScript = heredoc(workflow, "Read release metadata", "Validate release secrets");
    manifestScript = heredoc(workflow, "Verify release artifacts", "Upload release build");
    expect(metadataScript).toContain("release-notes.json");
    expect(manifestScript).toContain("releaseNotes");
  });

  afterEach(() => {
    for (const directory of workspaces.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("relies on a runtime that can detect malformed UTF-16", () => {
    expect(typeof String.prototype.isWellFormed).toBe("function");
    expect(metadataScript).toContain("String.prototype.isWellFormed");
    expect(manifestScript).toContain("String.prototype.isWellFormed");
  });

  it("truncates an astral character on the boundary without emitting a lone surrogate", () => {
    const body = `${"a".repeat(TRUNCATION_BOUNDARY - 1)}\u{1F600}${"b".repeat(200)}`;
    expect(body.codePointAt(TRUNCATION_BOUNDARY - 1)).toBe(0x1f600);
    const directory = workspace(
      changelogWith(section(RELEASE_VERSION, body), section("0.9.0-beta.29", "Older release.")),
    );

    runMetadata(directory);
    const notes = releaseNotes(directory);

    expect(notes[0].version).toBe(RELEASE_VERSION);
    expect(notes[0].notes.isWellFormed()).toBe(true);
    expect(notes[0].notes.length).toBeLessThanOrEqual(4096);
    expect(notes[0].notes).toContain("(Truncated. The full notes are on the release page.)");
    expect(notes[0].notes).not.toContain("\u{1F600}");
    expect(readFileSync(path.join(directory, "release-notes.json"), "utf8").isWellFormed()).toBe(
      true,
    );
  });

  it("keeps an astral character that fits entirely inside the truncation window", () => {
    const body = `${"a".repeat(TRUNCATION_BOUNDARY - 8)}\u{1F600}${"b".repeat(200)}`;
    const directory = workspace(changelogWith(section(RELEASE_VERSION, body)));

    runMetadata(directory);
    const notes = releaseNotes(directory);

    expect(notes[0].notes).toContain("\u{1F600}");
    expect(notes[0].notes.isWellFormed()).toBe(true);
  });

  it("publishes a manifest whose every string survives a strict UTF-8 decoder", () => {
    const body = `${"a".repeat(TRUNCATION_BOUNDARY - 1)}\u{1F600}${"b".repeat(200)}`;
    const directory = workspace(
      changelogWith(section(RELEASE_VERSION, body), section("0.9.0-beta.29", "Older release.")),
    );
    writeFileSync(path.join(directory, "release-body.md"), "unused");

    runMetadata(directory);
    runManifest(directory);

    const text = readFileSync(path.join(directory, "release-assets/publish/latest.json"), "utf8");
    const manifest = JSON.parse(text);
    expect(text.isWellFormed()).toBe(true);
    expect(manifest.notes.isWellFormed()).toBe(true);
    for (const entry of manifest.releaseNotes) {
      expect(entry.version.isWellFormed()).toBe(true);
      expect(entry.notes.isWellFormed()).toBe(true);
    }
  });

  it("fails the build instead of publishing a lone surrogate", () => {
    const directory = workspace(changelogWith(section(RELEASE_VERSION, "A normal release.")));
    runMetadata(directory);
    writeFileSync(
      path.join(directory, "release-notes.json"),
      JSON.stringify([{ version: RELEASE_VERSION, notes: "broken \ud83d" }]),
    );

    expect(() => runManifest(directory)).toThrowError(/release contract/);
  });

  it("stops the carried window at the first release without a body", () => {
    const directory = workspace(
      changelogWith(
        section(RELEASE_VERSION, "Newest release."),
        section("0.9.0-beta.29", "Previous release."),
        `## [0.9.0-beta.28] - 2026-09-08\n\n`,
        section("0.9.0-beta.27", "Older release."),
      ),
    );

    runMetadata(directory);

    expect(releaseNotes(directory).map((entry) => entry.version)).toEqual([
      RELEASE_VERSION,
      "0.9.0-beta.29",
    ]);
  });

  it("carries at most twelve contiguous releases newest first", () => {
    const sections = Array.from({ length: 20 }, (_unused, index) =>
      section(index === 0 ? RELEASE_VERSION : `0.9.0-beta.${30 - index}`, `Release ${index}.`),
    );
    const directory = workspace(changelogWith(...sections));

    runMetadata(directory);
    const notes = releaseNotes(directory);

    expect(notes).toHaveLength(12);
    expect(notes[0].version).toBe(RELEASE_VERSION);
    expect(notes[11].version).toBe("0.9.0-beta.19");
  });
});
