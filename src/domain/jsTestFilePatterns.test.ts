import { describe, expect, it } from "vitest";
import { isJsTestRelativePath } from "./jsTestFilePatterns";

describe("isJsTestRelativePath", () => {
  it("accepts .test. files across the JS/TS extension family", () => {
    expect(isJsTestRelativePath("src/math.test.ts")).toBe(true);
    expect(isJsTestRelativePath("src/math.test.js")).toBe(true);
    expect(isJsTestRelativePath("src/Component.test.tsx")).toBe(true);
    expect(isJsTestRelativePath("src/Component.test.jsx")).toBe(true);
    expect(isJsTestRelativePath("src/math.test.mjs")).toBe(true);
    expect(isJsTestRelativePath("src/math.test.cjs")).toBe(true);
    expect(isJsTestRelativePath("src/math.test.mts")).toBe(true);
    expect(isJsTestRelativePath("src/math.test.cts")).toBe(true);
  });

  it("accepts .spec. files across the JS/TS extension family", () => {
    expect(isJsTestRelativePath("src/math.spec.ts")).toBe(true);
    expect(isJsTestRelativePath("e2e/login.spec.tsx")).toBe(true);
    expect(isJsTestRelativePath("lib/util.spec.cjs")).toBe(true);
  });

  it("accepts JS/TS files inside a __tests__ directory", () => {
    expect(isJsTestRelativePath("src/__tests__/math.ts")).toBe(true);
    expect(isJsTestRelativePath("src/__tests__/nested/math.js")).toBe(true);
    expect(isJsTestRelativePath("__tests__/math.tsx")).toBe(true);
  });

  it("rejects production JS/TS files", () => {
    expect(isJsTestRelativePath("src/math.ts")).toBe(false);
    expect(isJsTestRelativePath("src/Component.tsx")).toBe(false);
    expect(isJsTestRelativePath("src/testResults.ts")).toBe(false);
    expect(isJsTestRelativePath("src/spec.ts")).toBe(false);
  });

  it("rejects non-JS files even when named like tests", () => {
    expect(isJsTestRelativePath("tests/math.test.php")).toBe(false);
    expect(isJsTestRelativePath("src/__tests__/fixture.json")).toBe(false);
    expect(isJsTestRelativePath("src/__tests__/notes.md")).toBe(false);
  });

  it("rejects declaration files", () => {
    expect(isJsTestRelativePath("src/math.test.d.ts")).toBe(false);
    expect(isJsTestRelativePath("src/__tests__/types.d.ts")).toBe(false);
    expect(isJsTestRelativePath("src/__tests__/types.d.mts")).toBe(false);
  });

  it("rejects files merely named __tests__ without the directory", () => {
    expect(isJsTestRelativePath("src/__tests__.ts")).toBe(false);
  });

  it("normalises Windows separators", () => {
    expect(isJsTestRelativePath("src\\__tests__\\math.ts")).toBe(true);
    expect(isJsTestRelativePath("src\\math.test.ts")).toBe(true);
  });
});
