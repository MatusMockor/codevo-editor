import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureApplicationBundleIdentity,
  digestApplicationBundleManifestRecords,
  MAX_APPLICATION_BUNDLE_ENTRIES,
  MAX_APPLICATION_BUNDLE_DEPTH,
  MAX_APPLICATION_BUNDLE_FILE_BYTES,
} from "./perfApplicationBundleIdentity.mjs";

const scratch = [];

afterEach(() => {
  for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true });
});

function applicationBundle() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codevo-bundle-identity-test-"));
  scratch.push(root);
  const bundle = path.join(root, "Codevo Editor.app");
  mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  mkdirSync(path.join(bundle, "Contents", "Resources", "assets"), { recursive: true });
  writeFileSync(path.join(bundle, "Contents", "Info.plist"), "<plist>identity</plist>");
  writeFileSync(path.join(bundle, "Contents", "MacOS", "codevo-editor"), "executable");
  writeFileSync(path.join(bundle, "Contents", "Resources", "index.html"), "<main>app</main>");
  writeFileSync(path.join(bundle, "Contents", "Resources", "assets", "index.js"), "boot()");
  return { root, bundle };
}

describe("captureApplicationBundleIdentity", () => {
  it("matches the shared cross-language canonical-record golden", () => {
    const records = [
      {
        kind: "directory",
        relative: ".",
        dev: "1",
        ino: "2",
        uid: "501",
        gid: "20",
        mode: "493",
        ctimeNs: "1700000000000000000",
        size: "0",
        contentSha256: "",
      },
      {
        kind: "file",
        relative: "Contents/Info.plist",
        dev: "1",
        ino: "3",
        uid: "501",
        gid: "20",
        mode: "420",
        ctimeNs: "1700000000000000001",
        size: "5",
        contentSha256: "a".repeat(64),
      },
      {
        kind: "file",
        relative: "Contents/Resources/index.js",
        dev: "1",
        ino: "4",
        uid: "501",
        gid: "20",
        mode: "420",
        ctimeNs: "1700000000000000002",
        size: "7",
        contentSha256: "b".repeat(64),
      },
    ];
    expect(digestApplicationBundleManifestRecords(records)).toBe(
      "a13d17934d6e4877c1ad52a3830be2b607016153ae11da15fa9933125cd3518e",
    );
  });

  it("deterministically covers the executable, Info.plist, and nested frontend resources", () => {
    const { bundle } = applicationBundle();
    const first = captureApplicationBundleIdentity(bundle);
    const second = captureApplicationBundleIdentity(bundle);

    expect(second).toEqual(first);
    expect(first).toMatchObject({ schemaVersion: 1, fileCount: 4 });
    expect(first.entryCount).toBeGreaterThan(first.fileCount);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);

    for (const relative of [
      "Contents/Info.plist",
      "Contents/MacOS/codevo-editor",
      "Contents/Resources/index.html",
      "Contents/Resources/assets/index.js",
    ]) {
      const before = captureApplicationBundleIdentity(bundle).digest;
      writeFileSync(path.join(bundle, relative), `${relative}-changed`);
      expect(captureApplicationBundleIdentity(bundle).digest).not.toBe(before);
    }
  });

  it("detects additions, renames, permission changes, and same-content inode replacement", () => {
    const { bundle } = applicationBundle();
    let before = captureApplicationBundleIdentity(bundle).digest;
    const resource = path.join(bundle, "Contents", "Resources", "index.html");

    const added = path.join(bundle, "Contents", "Resources", "late.js");
    writeFileSync(added, "late");
    expect(captureApplicationBundleIdentity(bundle).digest).not.toBe(before);
    before = captureApplicationBundleIdentity(bundle).digest;

    renameSync(added, `${added}.renamed`);
    expect(captureApplicationBundleIdentity(bundle).digest).not.toBe(before);
    before = captureApplicationBundleIdentity(bundle).digest;

    chmodSync(resource, 0o600);
    expect(captureApplicationBundleIdentity(bundle).digest).not.toBe(before);
    before = captureApplicationBundleIdentity(bundle).digest;

    const replacement = `${resource}.replacement`;
    writeFileSync(replacement, "<main>app</main>");
    renameSync(replacement, resource);
    expect(captureApplicationBundleIdentity(bundle).digest).not.toBe(before);
  });

  it("rejects file and directory symlinks anywhere in the bundle", () => {
    for (const kind of ["file", "directory"]) {
      const { root, bundle } = applicationBundle();
      const target = path.join(root, `outside-${kind}`);
      if (kind === "file") writeFileSync(target, "outside");
      else mkdirSync(target);
      symlinkSync(target, path.join(bundle, "Contents", "Resources", `linked-${kind}`));
      expect(() => captureApplicationBundleIdentity(bundle)).toThrow(/symbolic link/);
    }
  });

  it("rejects oversized files and excessive directory depth without reading unbounded data", () => {
    const oversized = applicationBundle();
    const huge = path.join(oversized.bundle, "Contents", "Resources", "huge.bin");
    writeFileSync(huge, "");
    truncateSync(huge, MAX_APPLICATION_BUNDLE_FILE_BYTES + 1);
    expect(() => captureApplicationBundleIdentity(oversized.bundle)).toThrow(/oversized file/);

    const deep = applicationBundle();
    let directory = path.join(deep.bundle, "Contents", "Resources");
    for (let index = 0; index <= MAX_APPLICATION_BUNDLE_DEPTH; index += 1) {
      directory = path.join(directory, "d");
      mkdirSync(directory);
    }
    expect(() => captureApplicationBundleIdentity(deep.bundle)).toThrow(/depth bound/);
  });

  it("stops directory enumeration at the remaining entry budget", () => {
    const { bundle } = applicationBundle();
    expect(() => captureApplicationBundleIdentity(bundle, { entryLimit: 3 })).toThrow(
      /entry-count bound/,
    );
    expect(() =>
      captureApplicationBundleIdentity(bundle, {
        entryLimit: MAX_APPLICATION_BUNDLE_ENTRIES + 1,
      }),
    ).toThrow(/entry limit was rejected/);
  });

  it("reserves ancestor directory names against one global enumeration budget", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codevo-bundle-budget-test-"));
    scratch.push(root);
    const bundle = path.join(root, "Codevo Editor.app");
    const firstDirectory = path.join(bundle, "a");
    mkdirSync(firstDirectory, { recursive: true });
    for (let index = 0; index < 6; index += 1) {
      writeFileSync(path.join(bundle, `z-${index}`), "pending ancestor sibling");
    }
    const outside = path.join(root, "outside");
    writeFileSync(outside, "must never be inspected past the global budget");
    symlinkSync(outside, path.join(firstDirectory, "child"));

    expect(() => captureApplicationBundleIdentity(bundle, { entryLimit: 8 })).toThrow(
      /entry-count bound/,
    );
  });
});
