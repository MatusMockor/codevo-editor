import { describe, expect, it } from "vitest";
import { detectHostWorkspacePathCase } from "./hostWorkspacePathCase";

describe("detectHostWorkspacePathCase", () => {
  it.each([
    [{ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }],
    [{ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }],
    [{ userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15" }],
  ])("folds case on macOS and Windows hosts %#", (host) => {
    expect(detectHostWorkspacePathCase(host)).toBe("insensitive");
  });

  it.each([
    [{ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }],
    [{ userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux aarch64)" }],
  ])("compares exactly on Linux hosts %#", (host) => {
    expect(detectHostWorkspacePathCase(host)).toBe("sensitive");
  });

  it.each([null, undefined, {}, { platform: "", userAgent: "" }, { userAgent: "Unknown" }])(
    "fails closed to case folding for an unknown host %#",
    (host) => {
      expect(detectHostWorkspacePathCase(host)).toBe("insensitive");
    },
  );
});
