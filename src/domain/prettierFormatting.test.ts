import { describe, expect, it } from "vitest";
import {
  detectPrettierConfigSource,
  isPrettierConfigFileName,
  isPrettierRcFileName,
  packageJsonDeclaresPrettier,
} from "./prettierFormatting";

describe("detectPrettierConfigSource", () => {
  it("detects rc files by exact name and known extensions", () => {
    expect(detectPrettierConfigSource([".prettierrc"], null)).toBe("rcFile");
    expect(detectPrettierConfigSource(["src", ".prettierrc.json"], null)).toBe("rcFile");
    expect(detectPrettierConfigSource([".prettierrc.yaml"], null)).toBe("rcFile");
    expect(detectPrettierConfigSource([".prettierrc.mjs"], null)).toBe("rcFile");
  });

  it("detects prettier.config files with supported extensions", () => {
    expect(detectPrettierConfigSource(["prettier.config.js"], null)).toBe("configFile");
    expect(detectPrettierConfigSource(["prettier.config.cjs"], null)).toBe("configFile");
    expect(detectPrettierConfigSource(["prettier.config.mts"], null)).toBe("configFile");
  });

  it("detects the prettier key in package.json", () => {
    const packageJson = JSON.stringify({ name: "app", prettier: { semi: false } });

    expect(detectPrettierConfigSource(["package.json"], packageJson)).toBe("packageJson");
  });

  it("prefers rc files over config files and package.json", () => {
    const packageJson = JSON.stringify({ prettier: {} });

    expect(
      detectPrettierConfigSource([".prettierrc", "prettier.config.js"], packageJson),
    ).toBe("rcFile");
    expect(detectPrettierConfigSource(["prettier.config.js"], packageJson)).toBe("configFile");
  });

  it("returns null when nothing declares prettier", () => {
    const packageJson = JSON.stringify({ name: "app", devDependencies: { prettier: "^3.0.0" } });

    expect(detectPrettierConfigSource(["src", "package.json"], packageJson)).toBeNull();
  });

  it("ignores lookalike file names", () => {
    expect(
      detectPrettierConfigSource(
        [".prettierrcold", "prettier.config.backup.js", "prettier.config", "my.prettierrc"],
        null,
      ),
    ).toBeNull();
  });
});

describe("isPrettierRcFileName", () => {
  it("accepts only the rc name and its known extensions", () => {
    expect(isPrettierRcFileName(".prettierrc")).toBe(true);
    expect(isPrettierRcFileName(".prettierrc.toml")).toBe(true);
    expect(isPrettierRcFileName(".prettierrc.exe")).toBe(false);
    expect(isPrettierRcFileName("prettierrc")).toBe(false);
  });
});

describe("isPrettierConfigFileName", () => {
  it("accepts only supported prettier.config extensions", () => {
    expect(isPrettierConfigFileName("prettier.config.ts")).toBe(true);
    expect(isPrettierConfigFileName("prettier.config.json")).toBe(false);
    expect(isPrettierConfigFileName("prettier.config")).toBe(false);
  });
});

describe("packageJsonDeclaresPrettier", () => {
  it("requires an own prettier key on a JSON object", () => {
    expect(packageJsonDeclaresPrettier(JSON.stringify({ prettier: "config-package" }))).toBe(true);
    expect(packageJsonDeclaresPrettier(JSON.stringify({ prettier: null }))).toBe(true);
    expect(packageJsonDeclaresPrettier(JSON.stringify({ name: "app" }))).toBe(false);
  });

  it("rejects missing, malformed, and non-object content", () => {
    expect(packageJsonDeclaresPrettier(null)).toBe(false);
    expect(packageJsonDeclaresPrettier("not json {")).toBe(false);
    expect(packageJsonDeclaresPrettier(JSON.stringify(["prettier"]))).toBe(false);
    expect(packageJsonDeclaresPrettier(JSON.stringify("prettier"))).toBe(false);
  });
});
