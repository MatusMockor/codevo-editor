import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  debugAppExecutables,
  debugAppLaunchExecutable,
} from "./debug-tauri-processes.mjs";

const repoRoot = path.join(path.sep, "workspace", "editor");
const debugRoot = path.join(repoRoot, "src-tauri", "target", "debug");
const macosBundleExecutable = path.join(
  debugRoot,
  "bundle",
  "macos",
  "Codevo Editor.app",
  "Contents",
  "MacOS",
  "codevo-editor",
);

describe("debugAppLaunchExecutable", () => {
  it("launches the plain unbundled binary on macOS, matching `debug:build --no-bundle` output", () => {
    expect(debugAppLaunchExecutable(repoRoot, "darwin")).toBe(
      path.join(debugRoot, "codevo-editor"),
    );
  });

  it("launches the plain Cargo binary on Linux, where no app bundle exists", () => {
    expect(debugAppLaunchExecutable(repoRoot, "linux")).toBe(
      path.join(debugRoot, "codevo-editor"),
    );
  });

  it("launches the Windows executable with its extension", () => {
    expect(debugAppLaunchExecutable(repoRoot, "win32")).toBe(
      path.join(debugRoot, "codevo-editor.exe"),
    );
  });
});

describe("debugAppExecutables", () => {
  it("matches current and legacy debug executables on every platform", () => {
    expect(debugAppExecutables(repoRoot)).toEqual([
      path.join(debugRoot, "codevo-editor"),
      path.join(debugRoot, "codevo-editor.exe"),
      macosBundleExecutable,
      path.join(debugRoot, "mockor-editor"),
      path.join(
        debugRoot,
        "bundle",
        "macos",
        "Mockor Editor.app",
        "Contents",
        "MacOS",
        "mockor-editor",
      ),
    ]);
  });

  it("still matches the macOS app bundle so `npm run debug:bundle` launches can be found and cleaned up", () => {
    expect(debugAppExecutables(repoRoot)).toContain(macosBundleExecutable);
  });

  it("includes every launch target it must be able to clean up", () => {
    const executables = debugAppExecutables(repoRoot);

    for (const platform of ["darwin", "linux", "win32"]) {
      expect(executables).toContain(
        debugAppLaunchExecutable(repoRoot, platform),
      );
    }
  });
});
