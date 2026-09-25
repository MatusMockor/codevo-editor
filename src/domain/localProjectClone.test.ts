import { describe, expect, it } from "vitest";
import {
  parseLocalProjectCloneJobRequest,
  parseLocalProjectCloneRequest,
  parseLocalProjectCloneSnapshot,
} from "./localProjectClone";

const id = "01234567-89ab-4cde-8fab-0123456789ab";
const request = {
  idempotencyKey: id,
  url: "https://github.com/acme/repo.git",
  name: "repo",
  parentPath: "/Users/dev",
};

describe("local clone contracts", () => {
  it("accepts URL, SSH, branch and absolute destination requests", () => {
    expect(parseLocalProjectCloneRequest(request)).toEqual(request);
    const branched = { ...request, url: "git@github.com:acme/repo.git", branch: "feature/one" };
    expect(parseLocalProjectCloneRequest(branched)).toEqual(branched);
    expect(
      parseLocalProjectCloneRequest({ ...request, parentPath: "C:\\Projects" }).parentPath,
    ).toBe("C:\\Projects");
    expect(parseLocalProjectCloneJobRequest({ cloneId: id })).toEqual({ cloneId: id });
  });
  it.each([
    null,
    [],
    {},
    { ...request, extra: true },
    { ...request, idempotencyKey: "x" },
    { ...request, idempotencyKey: id.toUpperCase() },
    { ...request, url: "file:///tmp/repo" },
    { ...request, url: "https://user:secret@github.com/acme/repo" },
    { ...request, name: "../repo" },
    { ...request, name: "x".repeat(65) },
    { ...request, parentPath: "relative" },
    { ...request, parentPath: "/a\0b" },
    { ...request, parentPath: "/" + "é".repeat(2048) },
    { ...request, branch: undefined },
    { ...request, branch: "-option" },
    { ...request, branch: "a..b" },
    { ...request, branch: "a".repeat(256) },
  ])("rejects malformed start request %#", (value) => {
    expect(() => parseLocalProjectCloneRequest(value)).toThrow();
  });
  it.each([{}, { cloneId: id, extra: true }, { cloneId: "other" }, []])(
    "rejects malformed job lookup %#",
    (value) => {
      expect(() => parseLocalProjectCloneJobRequest(value)).toThrow();
    },
  );
  it.each([
    { cloneId: id, status: "running", path: "/repo", error: null, progress: null, failure: null },
    { cloneId: id, status: "completed", path: "/repo", error: null, progress: null, failure: null },
    {
      cloneId: id,
      status: "failed",
      path: null,
      error: "Clone failed.",
      progress: null,
      failure: "other",
    },
    { cloneId: id, status: "cancelled", path: null, error: null, progress: null, failure: null },
  ])("accepts consistent snapshot $status", (value) => {
    expect(parseLocalProjectCloneSnapshot(value)).toEqual(value);
  });
  const snapshot = {
    cloneId: id,
    status: "completed",
    path: "/repo",
    error: null,
    progress: null,
    failure: null,
  };
  it.each([
    null,
    [],
    { ...snapshot, extra: true },
    { ...snapshot, status: "succeeded" },
    { ...snapshot, path: null },
    { ...snapshot, error: "failed" },
    { ...snapshot, status: "running", path: "repo" },
    { ...snapshot, status: "cancelled" },
    { ...snapshot, status: "failed", path: null, error: "", failure: "other" },
    { ...snapshot, status: "failed", path: null, error: "é".repeat(2049), failure: "other" },
    { ...snapshot, cloneId: "foreign" },
  ])("rejects inconsistent snapshot %#", (value) => {
    expect(() => parseLocalProjectCloneSnapshot(value)).toThrow();
  });
});

describe("local clone progress and failure contract", () => {
  const cloneId = "01234567-89ab-4cde-8fab-0123456789ab";
  const running = {
    cloneId,
    status: "running",
    path: "/Users/dev/code/repo",
    error: null,
    progress: { phase: "receiving", percent: 45, receivedBytes: 1024, bytesPerSecond: null },
    failure: null,
  };

  it("accepts running progress and typed failures", () => {
    expect(parseLocalProjectCloneSnapshot(running)).toEqual(running);
    expect(
      parseLocalProjectCloneSnapshot({
        cloneId,
        status: "failed",
        path: null,
        error: "Cloning failed.",
        progress: null,
        failure: "authentication",
      }),
    ).toMatchObject({ status: "failed", failure: "authentication" });
  });

  it.each([
    ["progress on a completed clone", { ...running, status: "completed" }],
    ["a failure on a running clone", { ...running, failure: "network" }],
    ["an unknown phase", { ...running, progress: { ...running.progress, phase: "packing" } }],
    ["a fractional percent", { ...running, progress: { ...running.progress, percent: 4.5 } }],
    ["a percent above 100", { ...running, progress: { ...running.progress, percent: 101 } }],
    ["negative bytes", { ...running, progress: { ...running.progress, receivedBytes: -1 } }],
    ["unknown progress keys", { ...running, progress: { ...running.progress, raw: "x" } }],
    [
      "a missing failure key",
      { cloneId, status: "running", path: "/a", error: null, progress: null },
    ],
    [
      "an unknown failure",
      { cloneId, status: "failed", path: null, error: "x", progress: null, failure: "disk" },
    ],
    [
      "a failed clone without a failure kind",
      { cloneId, status: "failed", path: null, error: "x", progress: null, failure: null },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseLocalProjectCloneSnapshot(value)).toThrow("contract");
  });

  it("accepts ensureParent only as literal true", () => {
    const base = {
      idempotencyKey: cloneId,
      url: "https://github.com/acme/repo.git",
      name: "repo",
      parentPath: "/Users/dev/code",
    };
    expect(parseLocalProjectCloneRequest({ ...base, ensureParent: true })).toEqual({
      ...base,
      ensureParent: true,
    });
    expect(() => parseLocalProjectCloneRequest({ ...base, ensureParent: false })).toThrow();
    expect(() => parseLocalProjectCloneRequest({ ...base, ensureParent: "yes" })).toThrow();
  });
});
