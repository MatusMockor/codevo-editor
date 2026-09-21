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
    { cloneId: id, status: "running", path: "/repo", error: null },
    { cloneId: id, status: "completed", path: "/repo", error: null },
    { cloneId: id, status: "failed", path: null, error: "Clone failed." },
    { cloneId: id, status: "cancelled", path: null, error: null },
  ])("accepts consistent snapshot $status", (value) => {
    expect(parseLocalProjectCloneSnapshot(value)).toEqual(value);
  });
  const snapshot = { cloneId: id, status: "completed", path: "/repo", error: null };
  it.each([
    null,
    [],
    { ...snapshot, extra: true },
    { ...snapshot, status: "succeeded" },
    { ...snapshot, path: null },
    { ...snapshot, error: "failed" },
    { ...snapshot, status: "running", path: "repo" },
    { ...snapshot, status: "cancelled" },
    { ...snapshot, status: "failed", path: null, error: "" },
    { ...snapshot, status: "failed", path: null, error: "é".repeat(2049) },
    { ...snapshot, cloneId: "foreign" },
  ])("rejects inconsistent snapshot %#", (value) => {
    expect(() => parseLocalProjectCloneSnapshot(value)).toThrow();
  });
});
