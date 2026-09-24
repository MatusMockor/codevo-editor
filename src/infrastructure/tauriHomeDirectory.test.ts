import { describe, expect, it, vi } from "vitest";
import {
  createTauriWorkspaceHomeResolver,
  MAX_HOME_DIRECTORY_PATH_BYTES,
} from "./tauriHomeDirectory";

const LINUX_HOME = { path: "/Users/me", pathCase: "sensitive" } as const;
const NO_HOME = { path: null, pathCase: "sensitive" } as const;

describe("createTauriWorkspaceHomeResolver", () => {
  it("returns the native home directory", async () => {
    const resolve = createTauriWorkspaceHomeResolver(
      async () => "/Users/me",
      () => true,
      () => "sensitive",
    );

    await expect(resolve()).resolves.toEqual(LINUX_HOME);
  });

  it("returns null without the native runtime and never reads the directory", async () => {
    const read = vi.fn(async () => "/Users/me");
    const resolve = createTauriWorkspaceHomeResolver(
      read,
      () => false,
      () => "sensitive",
    );

    await expect(resolve()).resolves.toEqual(NO_HOME);
    expect(read).not.toHaveBeenCalled();
  });

  it("returns null instead of leaking a rejection or a synchronous throw", async () => {
    const rejecting = createTauriWorkspaceHomeResolver(
      () => Promise.reject(new Error("path plugin denied")),
      () => true,
      () => "sensitive",
    );
    const throwing = createTauriWorkspaceHomeResolver(
      () => {
        throw new Error("boom");
      },
      () => true,
      () => "sensitive",
    );
    const detectorThrows = createTauriWorkspaceHomeResolver(
      async () => "/Users/me",
      () => {
        throw new Error("no runtime");
      },
      () => "sensitive",
    );

    await expect(rejecting()).resolves.toEqual(NO_HOME);
    await expect(throwing()).resolves.toEqual(NO_HOME);
    await expect(detectorThrows()).resolves.toEqual(NO_HOME);
  });

  it.each([
    ["an empty path", ""],
    ["a relative path", "Users/me"],
    ["a NUL byte", "/Users/me\u0000x"],
    ["an oversized path", `/${"a".repeat(MAX_HOME_DIRECTORY_PATH_BYTES)}`],
  ])("rejects %s", async (_label, path) => {
    const resolve = createTauriWorkspaceHomeResolver(
      async () => path,
      () => true,
      () => "sensitive",
    );

    await expect(resolve()).resolves.toEqual(NO_HOME);
  });

  it("reads the home directory once and shares the result", async () => {
    const read = vi.fn(async () => "/Users/me");
    const resolve = createTauriWorkspaceHomeResolver(
      read,
      () => true,
      () => "sensitive",
    );

    await expect(Promise.all([resolve(), resolve()])).resolves.toEqual([LINUX_HOME, LINUX_HOME]);
    await expect(resolve()).resolves.toEqual(LINUX_HOME);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed read", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce("/Users/me");
    const resolve = createTauriWorkspaceHomeResolver(
      read,
      () => true,
      () => "sensitive",
    );

    await expect(resolve()).resolves.toEqual(NO_HOME);
    await Promise.resolve();
    await expect(resolve()).resolves.toEqual(LINUX_HOME);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reports the host path case alongside the home folder", async () => {
    const resolve = createTauriWorkspaceHomeResolver(
      async () => "/Users/me",
      () => true,
      () => "insensitive",
    );

    await expect(resolve()).resolves.toEqual({ path: "/Users/me", pathCase: "insensitive" });
  });

  it("fails closed to case folding when host detection throws", async () => {
    const resolve = createTauriWorkspaceHomeResolver(
      async () => "/Users/me",
      () => true,
      () => {
        throw new Error("no navigator");
      },
    );

    await expect(resolve()).resolves.toEqual({ path: "/Users/me", pathCase: "insensitive" });
  });
});
