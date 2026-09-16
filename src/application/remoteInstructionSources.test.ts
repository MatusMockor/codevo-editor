// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  readRemoteInstructionSourceRevision,
  readRemoteInstructionRoot,
  removeRemoteInstructionRoot,
  saveRemoteInstructionRoot,
} from "./remoteInstructionSources";

describe("remote instruction sources", () => {
  beforeEach(() => localStorage.clear());
  it("persists an explicit mapping isolated by server, runner, and project", () => {
    saveRemoteInstructionRoot("a", "r", "p", "/work/local");
    expect(readRemoteInstructionRoot("a", "r", "p")).toBe("/work/local");
    for (const owner of [
      ["b", "r", "p"],
      ["a", "s", "p"],
      ["a", "r", "q"],
    ]) {
      expect(readRemoteInstructionRoot(owner[0], owner[1], owner[2])).toBeUndefined();
    }
    saveRemoteInstructionRoot("b", "r", "p", "/other");
    removeRemoteInstructionRoot("a", "r", "p");
    expect(readRemoteInstructionRoot("a", "r", "p")).toBeUndefined();
    expect(readRemoteInstructionRoot("b", "r", "p")).toBe("/other");
  });
  it("changes revision across source A to B to A", () => {
    saveRemoteInstructionRoot("s", "r", "p", "/a");
    const captured = readRemoteInstructionSourceRevision();
    saveRemoteInstructionRoot("s", "r", "p", "/b");
    saveRemoteInstructionRoot("s", "r", "p", "/a");
    expect(readRemoteInstructionRoot("s", "r", "p")).toBe("/a");
    expect(readRemoteInstructionSourceRevision()).toBeGreaterThan(captured);
  });
  it("rejects unnormalized, relative, oversized roots and invalid identities", () => {
    for (const root of [
      "relative",
      "/a/../b",
      "/a/",
      "/a//b",
      "/a\u0000",
      "/" + "ž".repeat(3000),
    ]) {
      expect(() => saveRemoteInstructionRoot("a", "r", "p", root)).toThrow();
    }
    expect(() => saveRemoteInstructionRoot("", "r", "p", "/work")).toThrow();
    expect(localStorage.length).toBe(0);
  });
  it("fails closed on corrupt persistence instead of silently switching to global-only", () => {
    saveRemoteInstructionRoot("a", "r", "p", "/work");
    localStorage.setItem(localStorage.key(0)!, "{}");
    expect(() => readRemoteInstructionRoot("a", "r", "p")).toThrow();
  });
  it("refuses overflow without deleting existing mappings", () => {
    for (let i = 0; i < 256; i++) saveRemoteInstructionRoot("s", "r", String(i), "/work");
    expect(() => saveRemoteInstructionRoot("s", "r", "overflow", "/work")).toThrow();
    expect(readRemoteInstructionRoot("s", "r", "0")).toBe("/work");
  });
});
