import { describe, expect, it } from "vitest";
import {
  MAX_JS_TEST_PACKAGE_ROOT_BYTES,
  validatedJsTestExecutionAuthority,
  validatedJsTestPackageRootRelativePath,
} from "./jsTestExecutionAuthority";

describe("JavaScript test execution authority", () => {
  it.each(["", "packages/web", "packages\\web"])(
    "accepts workspace-confined package root %j",
    (value) => {
      expect(validatedJsTestPackageRootRelativePath(value)).toBe(value.replace("\\", "/"));
    },
  );

  it.each(["/tmp/package", "../outside", "packages/../outside", "packages//web", "C:/repo"])(
    "rejects foreign package root %j",
    (value) => {
      expect(() => validatedJsTestPackageRootRelativePath(value)).toThrow(
        "workspace-confined relative path",
      );
    },
  );

  it("enforces the exact UTF-8 byte bound and returns an immutable copy", () => {
    expect(validatedJsTestPackageRootRelativePath("x".repeat(MAX_JS_TEST_PACKAGE_ROOT_BYTES))).toBe(
      "x".repeat(MAX_JS_TEST_PACKAGE_ROOT_BYTES),
    );
    expect(() =>
      validatedJsTestPackageRootRelativePath(`é${"x".repeat(MAX_JS_TEST_PACKAGE_ROOT_BYTES - 1)}`),
    ).toThrow("workspace-confined relative path");
    const authority = validatedJsTestExecutionAuthority({
      packageRootRelativePath: "packages/web",
    });
    expect(Object.isFrozen(authority)).toBe(true);
  });
});
