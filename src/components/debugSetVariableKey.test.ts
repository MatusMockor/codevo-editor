import { describe, expect, it } from "vitest";
import { isDebugSetVariableShortcut } from "./debugSetVariableKey";

describe("Set Value tree shortcut", () => {
  it("uses Enter only on macOS and F2 only on Windows/Linux", () => {
    expect(isDebugSetVariableShortcut("Enter", "MacIntel")).toBe(true);
    expect(isDebugSetVariableShortcut("F2", "MacIntel")).toBe(false);
    expect(isDebugSetVariableShortcut("F2", "Win32")).toBe(true);
    expect(isDebugSetVariableShortcut("Enter", "Win32")).toBe(false);
    expect(isDebugSetVariableShortcut("F2", "Linux x86_64")).toBe(true);
    expect(isDebugSetVariableShortcut("Enter", "Linux x86_64")).toBe(false);
    expect(isDebugSetVariableShortcut("F2", "FreeBSD")).toBe(false);
    expect(isDebugSetVariableShortcut("F2", "")).toBe(false);
  });
});
