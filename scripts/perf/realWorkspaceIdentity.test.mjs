import { randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureRealWorkspaceIdentity,
  assertOpaqueDescriptorBindings,
  createOpaquePrivateValueDescriptors,
  createOpaqueTargetDescriptors,
  persistedRealWorkspaceIdentity,
  realWorkspaceIdentityFenceFailure,
} from "./realWorkspaceIdentity.mjs";

const roots = [];
const key = Buffer.alloc(32, 7);

function scratchRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), `codevo-real-workspace-${randomUUID()}-`));
  roots.push(root);
  return root;
}

function write(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function capture(root, overrides = {}) {
  return captureRealWorkspaceIdentity({ root, hmacKey: key, dirty: false, ...overrides });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("captureRealWorkspaceIdentity", () => {
  it("creates a stable aggregate keyed identity without returning paths or content", () => {
    const root = scratchRoot();
    write(root, "src/private-name.ts", "export const privateValue = 'secret-source';\n");
    const first = capture(root);
    const second = capture(root);

    expect(first).toEqual(second);
    expect(first.workspaceIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual({
      identityVersion: "real-workspace-hmac-v1",
      identityScope: "included-tree-excluding-generated-and-cache-directories",
      traversalAuthority: "best-effort-revalidation-on-non-adversarial-local-host",
      workspaceIdentity: first.workspaceIdentity,
      directoryCount: 2,
      fileCount: 1,
      totalBytes: Buffer.byteLength("export const privateValue = 'secret-source';\n"),
      dirty: false,
    });
    const serialized = JSON.stringify(persistedRealWorkspaceIdentity(first));
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("private-name.ts");
    expect(serialized).not.toContain("secret-source");
    expect(serialized).not.toMatch(
      /root|path|source|symbol|query|remote|branch|commit|fileHashes/i,
    );
  });

  it("uses a key so the same workspace cannot be matched across unrelated captures", () => {
    const root = scratchRoot();
    write(root, "src/index.ts", "export {};\n");

    expect(capture(root).workspaceIdentity).not.toBe(
      capture(root, { hmacKey: randomBytes(32) }).workspaceIdentity,
    );
  });

  it("changes identity for A to B content and path changes", () => {
    const left = scratchRoot();
    const right = scratchRoot();
    write(left, "src/a.ts", "A");
    write(right, "src/a.ts", "B");
    expect(capture(left).workspaceIdentity).not.toBe(capture(right).workspaceIdentity);

    write(right, "src/a.ts", "A");
    write(right, "src/b.ts", "A");
    expect(capture(left).workspaceIdentity).not.toBe(capture(right).workspaceIdentity);
  });

  it("binds identical bytes to the exact root authority for A to B isolation", () => {
    const left = scratchRoot();
    const right = scratchRoot();
    write(left, "src/index.ts", "same");
    write(right, "src/index.ts", "same");
    const leftSnapshot = capture(left);
    const rightSnapshot = capture(right);

    expect(leftSnapshot.workspaceIdentity).not.toBe(rightSnapshot.workspaceIdentity);
    expect(realWorkspaceIdentityFenceFailure(leftSnapshot, rightSnapshot)).toMatch(
      /run is invalid/,
    );
  });

  it("ignores only closed generated/cache directory names", () => {
    const root = scratchRoot();
    write(root, "src/index.ts", "stable");
    write(root, "node_modules/pkg/index.js", "first");
    const before = capture(root);
    write(root, "node_modules/pkg/index.js", "second");
    expect(capture(root)).toEqual(before);

    write(root, "custom-cache/index.js", "included");
    expect(capture(root).workspaceIdentity).not.toBe(before.workspaceIdentity);
  });

  it("rejects symlinks instead of following them", () => {
    const root = scratchRoot();
    const outside = scratchRoot();
    write(outside, "secret.ts", "secret");
    symlinkSync(path.join(outside, "secret.ts"), path.join(root, "linked.ts"));

    expect(() => capture(root)).toThrow(/refuses symbolic links/);
  });

  it.each([
    ["maxFiles", { maxFiles: 1 }, ["a.ts", "b.ts"]],
    ["maxBytes", { maxBytes: 1 }, ["a.ts"]],
    ["maxDirectories", { maxDirectories: 1 }, ["src/a.ts"]],
    ["maxDepth", { maxDepth: 1 }, ["a/b/c.ts"]],
    ["maxPathBytes", { maxPathBytes: 4 }, ["long-name.ts"]],
  ])("fails closed on %s", (limit, limits, files) => {
    const root = scratchRoot();
    for (const file of files) write(root, file, "ab");
    expect(() => capture(root, { limits })).toThrow(new RegExp(limit));
  });

  it("rejects weak keys, non-boolean dirty state, and unknown limit fields", () => {
    const root = scratchRoot();
    expect(() => capture(root, { hmacKey: "short" })).toThrow(/at least 32 bytes/);
    expect(() => capture(root, { dirty: "yes" })).toThrow(/must be a boolean/);
    expect(() => capture(root, { limits: { maxFiles: 1, unbounded: true } })).toThrow(
      /Unknown real-workspace identity limit/,
    );
  });

  it("caps concurrent growth before reading more than maxBytes", () => {
    const root = scratchRoot();
    const file = path.join(root, "growing.ts");
    write(root, "growing.ts", "ab");
    let grew = false;

    expect(() =>
      capture(root, {
        limits: { maxBytes: 2 },
        readChunk(...args) {
          if (!grew) {
            grew = true;
            appendFileSync(file, "c");
          }
          return readSync(...args);
        },
      }),
    ).toThrow(/exceeded maxBytes/);
  });
});

describe("realWorkspaceIdentityFenceFailure", () => {
  it("accepts an exact unchanged snapshot", () => {
    const root = scratchRoot();
    write(root, "src/index.ts", "stable");
    const snapshot = capture(root, { dirty: true });
    expect(realWorkspaceIdentityFenceFailure(snapshot, capture(root, { dirty: true }))).toBeNull();
  });

  it("fails when bytes or dirty status change", () => {
    const root = scratchRoot();
    write(root, "src/index.ts", "before");
    const before = capture(root, { dirty: false });
    write(root, "src/index.ts", "after");
    expect(realWorkspaceIdentityFenceFailure(before, capture(root, { dirty: false }))).toMatch(
      /run is invalid/,
    );

    write(root, "src/index.ts", "before");
    expect(realWorkspaceIdentityFenceFailure(before, capture(root, { dirty: true }))).toMatch(
      /dirty status changed/,
    );
  });
});

describe("opaque descriptors", () => {
  it("sorts targets deterministically and reveals neither path nor private values", () => {
    const workspaceIdentity = "a".repeat(64);
    const targets = createOpaqueTargetDescriptors({
      hmacKey: key,
      workspaceIdentity,
      targets: [
        { kind: "navigation", relativePath: "src/z.ts", line: 9, column: 2 },
        { kind: "document", relativePath: "src/a.ts", line: 1, column: 1 },
      ],
    });
    const reversed = createOpaqueTargetDescriptors({
      hmacKey: key,
      workspaceIdentity,
      targets: [
        { kind: "document", relativePath: "src/a.ts", line: 1, column: 1 },
        { kind: "navigation", relativePath: "src/z.ts", line: 9, column: 2 },
      ],
    });

    expect(targets).toEqual(reversed);
    expect(targets.map(({ id }) => id)).toEqual(["target-001", "target-002"]);
    expect(JSON.stringify(targets)).not.toMatch(/src|a\.ts|z\.ts|navigation|document/);

    const privateValues = createOpaquePrivateValueDescriptors({
      hmacKey: key,
      workspaceIdentity,
      kind: "query",
      values: ["private-query-z", "private-query-a"],
    });
    expect(privateValues.map(({ id }) => id)).toEqual(["query-001", "query-002"]);
    expect(JSON.stringify(privateValues)).not.toContain("private-query");
  });

  it("binds fingerprints to the workspace identity", () => {
    const target = { kind: "document", relativePath: "src/index.ts", line: 1, column: 1 };
    const left = createOpaqueTargetDescriptors({
      hmacKey: key,
      workspaceIdentity: "a".repeat(64),
      targets: [target],
    });
    const right = createOpaqueTargetDescriptors({
      hmacKey: key,
      workspaceIdentity: "b".repeat(64),
      targets: [target],
    });
    expect(left[0].fingerprint).not.toBe(right[0].fingerprint);
    expect(() =>
      assertOpaqueDescriptorBindings({
        hmacKey: key,
        workspaceIdentity: "b".repeat(64),
        kind: "target",
        descriptors: left,
      }),
    ).toThrow(/not bound to this workspace/);
  });

  it("uses one canonical three-digit boundary through 100 descriptors", () => {
    const descriptors = createOpaquePrivateValueDescriptors({
      hmacKey: key,
      workspaceIdentity: "a".repeat(64),
      kind: "query",
      values: Array.from({ length: 100 }, (_, index) => `query-${index}`),
    });
    expect(descriptors).toHaveLength(100);
    expect(descriptors.at(-1).id).toBe("query-100");
    expect(
      assertOpaqueDescriptorBindings({
        hmacKey: key,
        workspaceIdentity: "a".repeat(64),
        kind: "query",
        descriptors,
      }),
    ).toBe(true);
  });

  it("rejects traversal and secret-bearing extra fields", () => {
    expect(() =>
      createOpaqueTargetDescriptors({
        hmacKey: key,
        workspaceIdentity: "a".repeat(64),
        targets: [
          { kind: "document", relativePath: "../secret.ts", line: 1, column: 1, symbol: "x" },
        ],
      }),
    ).toThrow(/forbidden field/);
  });
});
