import { describe, expect, it } from "vitest";
import { detectNodePackageManager } from "./packageManagerDetection";

describe("detectNodePackageManager", () => {
  it("detects pnpm from pnpm-lock.yaml", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["package.json", "pnpm-lock.yaml"],
      }),
    ).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["package.json", "yarn.lock"],
      }),
    ).toBe("yarn");
  });

  it("detects bun from bun.lockb", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["package.json", "bun.lockb"],
      }),
    ).toBe("bun");
  });

  it("detects bun from bun.lock", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["package.json", "bun.lock"],
      }),
    ).toBe("bun");
  });

  it("detects npm from package-lock.json", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["package.json", "package-lock.json"],
      }),
    ).toBe("npm");
  });

  it("falls back to npm without any lockfile", () => {
    expect(
      detectNodePackageManager({ rootFileNames: ["package.json"] }),
    ).toBe("npm");
  });

  it("resolves multiple lockfiles with deterministic pnpm > yarn > bun > npm priority", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: [
          "pnpm-lock.yaml",
          "yarn.lock",
          "bun.lockb",
          "package-lock.json",
        ],
      }),
    ).toBe("pnpm");
    expect(
      detectNodePackageManager({
        rootFileNames: ["yarn.lock", "bun.lockb", "package-lock.json"],
      }),
    ).toBe("yarn");
    expect(
      detectNodePackageManager({
        rootFileNames: ["bun.lock", "package-lock.json"],
      }),
    ).toBe("bun");
  });

  it("prefers the package.json packageManager field over lockfiles", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["yarn.lock"],
        packageJsonText: JSON.stringify({ packageManager: "pnpm@9.1.0" }),
      }),
    ).toBe("pnpm");
  });

  it("accepts a packageManager field without a version", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["package-lock.json"],
        packageJsonText: JSON.stringify({ packageManager: "yarn" }),
      }),
    ).toBe("yarn");
  });

  it("falls back to lockfile detection for an unknown packageManager field", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["yarn.lock"],
        packageJsonText: JSON.stringify({ packageManager: "turbo@2.0.0" }),
      }),
    ).toBe("yarn");
  });

  it("falls back to lockfile detection for a non-string packageManager field", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["bun.lockb"],
        packageJsonText: JSON.stringify({ packageManager: 9 }),
      }),
    ).toBe("bun");
  });

  it("falls back to lockfile detection for malformed package.json text", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["pnpm-lock.yaml"],
        packageJsonText: "{not json",
      }),
    ).toBe("pnpm");
  });

  it("ignores an absent package.json text", () => {
    expect(
      detectNodePackageManager({
        rootFileNames: ["yarn.lock"],
        packageJsonText: null,
      }),
    ).toBe("yarn");
  });
});
