import { describe, expect, it } from "vitest";
import {
  MAX_EXCEPTION_TYPE_FILTER_COUNT,
  exceptionTypeFilterNameError,
  isExceptionTypeFilter,
  shouldPauseForExceptionType,
} from "./debugExceptionTypeFilter";

describe("debugExceptionTypeFilter", () => {
  it("accepts bounded JavaScript constructor names and dotted paths", () => {
    expect(exceptionTypeFilterNameError("Error")).toBeNull();
    expect(exceptionTypeFilterNameError("node.errors.AbortError")).toBeNull();
    expect(isExceptionTypeFilter(["Error", "node.errors.AbortError"])).toBe(true);
  });

  it.each(["", "Error-name", ".Error", "Error.", "Error..Cause", "1Error"])(
    "rejects invalid constructor name %j",
    (name) => {
      expect(exceptionTypeFilterNameError(name)).not.toBeNull();
    },
  );

  it("rejects names beyond the shared depth and UTF-8 byte bounds", () => {
    expect(exceptionTypeFilterNameError("a.b.c.d.e.f.g.h.i")).not.toBeNull();
    expect(exceptionTypeFilterNameError(`E${"x".repeat(256)}`)).not.toBeNull();
  });

  it("rejects oversized, duplicate, mutable, and malformed lists", () => {
    expect(
      isExceptionTypeFilter(
        Array.from({ length: MAX_EXCEPTION_TYPE_FILTER_COUNT + 1 }, (_, i) => `E${i}`),
      ),
    ).toBe(false);
    expect(isExceptionTypeFilter(["Error", "Error"])).toBe(false);
    expect(isExceptionTypeFilter(["Error-name"])).toBe(false);
    expect(isExceptionTypeFilter("Error")).toBe(false);
  });

  it("matches constructor names by exact case-sensitive leaf segment", () => {
    expect(shouldPauseForExceptionType(["Error", "app.DomainError"], "Error")).toBe(true);
    expect(shouldPauseForExceptionType(["Error", "app.DomainError"], "DomainError")).toBe(true);
    expect(shouldPauseForExceptionType(["Error"], "TypeError")).toBe(false);
    expect(shouldPauseForExceptionType(["Error"], "error")).toBe(false);
  });

  it("pauses when filtering is off or classification is uncertain", () => {
    expect(shouldPauseForExceptionType([], "TypeError")).toBe(true);
    expect(shouldPauseForExceptionType(["Error"], null)).toBe(true);
    expect(shouldPauseForExceptionType(["Error"], "not-a-constructor")).toBe(true);
    expect(shouldPauseForExceptionType(["DomainError"], "app.DomainError")).toBe(true);
    expect(shouldPauseForExceptionType(["Error", "Error"], "TypeError")).toBe(true);
  });
});
