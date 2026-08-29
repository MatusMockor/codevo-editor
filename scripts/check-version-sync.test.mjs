import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectVersionSync } from "./check-version-sync.mjs";

const temporaryDirectories = [];

async function createManifests(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "codevo-version-sync-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "src-tauri"));
  const manifests = {
    "package.json": '{"name":"codevo-editor","version":"0.2.0-beta.1"}',
    "package-lock.json":
      '{"name":"codevo-editor","version":"0.2.0-beta.1","packages":{"":{"name":"codevo-editor","version":"0.2.0-beta.1"}}}',
    "src-tauri/Cargo.toml": '[package]\nname = "codevo-editor"\nversion = "0.2.0-beta.1"\n',
    "src-tauri/Cargo.lock":
      'version = 4\n\n[[package]]\nname = "codevo-editor"\nversion = "0.2.0-beta.1"\n',
    "src-tauri/tauri.conf.json": '{"productName":"Codevo Editor","version":"0.2.0-beta.1"}',
    ...overrides,
  };
  await Promise.all(
    Object.entries(manifests).map(([relativePath, source]) =>
      writeFile(join(directory, relativePath), source),
    ),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("version synchronization", () => {
  it("accepts one exact prerelease version across every manifest", async () => {
    const directory = await createManifests();

    await expect(inspectVersionSync(directory)).resolves.toBe("0.2.0-beta.1");
  });

  it.each([
    [
      "package lock authority projection",
      {
        "package-lock.json":
          '{"name":"codevo-editor","version":"0.2.0","packages":{"":{"name":"codevo-editor","version":"0.2.0-beta.1"}}}',
      },
      "package-lock.json version 0.2.0 does not match package.json 0.2.0-beta.1",
    ],
    [
      "package lock root package",
      {
        "package-lock.json":
          '{"name":"codevo-editor","version":"0.2.0-beta.1","packages":{"":{"name":"codevo-editor","version":"0.2.0"}}}',
      },
      'package-lock.json packages[""] version 0.2.0 does not match package.json 0.2.0-beta.1',
    ],
    [
      "Cargo manifest",
      { "src-tauri/Cargo.toml": '[package]\nname = "codevo-editor"\nversion = "0.2.0"\n' },
      "src-tauri/Cargo.toml version 0.2.0 does not match package.json 0.2.0-beta.1",
    ],
    [
      "Cargo lock package",
      {
        "src-tauri/Cargo.lock":
          'version = 4\n\n[[package]]\nname = "codevo-editor"\nversion = "0.2.0"\n',
      },
      "src-tauri/Cargo.lock version 0.2.0 does not match package.json 0.2.0-beta.1",
    ],
    [
      "Tauri config",
      { "src-tauri/tauri.conf.json": '{"productName":"Codevo Editor","version":"0.2.0"}' },
      "src-tauri/tauri.conf.json version 0.2.0 does not match package.json 0.2.0-beta.1",
    ],
  ])("fails closed when the %s version differs", async (_label, overrides, expectedError) => {
    const directory = await createManifests(overrides);

    await expect(inspectVersionSync(directory)).rejects.toThrow(expectedError);
  });

  it("fails closed when the authority version is malformed", async () => {
    const directory = await createManifests({
      "package.json": '{"name":"codevo-editor","version":"01.2.0"}',
    });

    await expect(inspectVersionSync(directory)).rejects.toThrow(
      "package.json has a malformed semantic version",
    );
  });

  it("rejects numeric prerelease identifiers with leading zeroes", async () => {
    const directory = await createManifests({
      "package.json": '{"name":"codevo-editor","version":"0.2.0-beta.01"}',
    });

    await expect(inspectVersionSync(directory)).rejects.toThrow(
      "package.json has a malformed semantic version",
    );
  });

  it.each([
    [
      "package authority",
      { "package.json": '{"version":"0.2.0-beta.1","version":"0.2.0-beta.1"}' },
      "package.json contains duplicate key",
    ],
    [
      "package lock projection",
      {
        "package-lock.json":
          '{"version":"0.2.0-beta.1","version":"0.2.0-beta.1","packages":{"":{"version":"0.2.0-beta.1"}}}',
      },
      "package-lock.json contains duplicate key",
    ],
    [
      "package lock root package",
      {
        "package-lock.json":
          '{"version":"0.2.0-beta.1","packages":{"":{"version":"0.2.0-beta.1","version":"0.2.0-beta.1"}}}',
      },
      "package-lock.json contains duplicate key",
    ],
    [
      "Tauri projection",
      {
        "src-tauri/tauri.conf.json": '{"version":"0.2.0-beta.1","version":"0.2.0-beta.1"}',
      },
      "src-tauri/tauri.conf.json contains duplicate key",
    ],
  ])("fails closed on a duplicate version key in the %s", async (_label, overrides, error) => {
    const directory = await createManifests(overrides);

    await expect(inspectVersionSync(directory)).rejects.toThrow(error);
  });

  it("fails closed when a manifest is invalid or ambiguous", async () => {
    const directory = await createManifests({
      "src-tauri/Cargo.toml":
        '[package]\nname = "codevo-editor"\nversion = "0.2.0-beta.1"\nversion = "0.2.0-beta.1"\n',
    });

    await expect(inspectVersionSync(directory)).rejects.toThrow(
      "src-tauri/Cargo.toml package version is ambiguous",
    );
  });
});
