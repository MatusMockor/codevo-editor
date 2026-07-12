import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  debugAppExecutables,
  debugAppLaunchExecutable,
} from "./debug-tauri-processes.mjs";

describe("debugAppExecutables", () => {
  it("launches the current bundled Codevo executable", () => {
    const repoRoot = path.join(path.sep, "workspace", "editor");

    expect(debugAppLaunchExecutable(repoRoot)).toBe(
      path.join(
        repoRoot,
        "src-tauri",
        "target",
        "debug",
        "bundle",
        "macos",
        "Codevo Editor.app",
        "Contents",
        "MacOS",
        "codevo-editor",
      ),
    );
  });

  it("matches current and legacy debug executables during the rename transition", () => {
    const repoRoot = path.join(path.sep, "workspace", "editor");

    expect(debugAppExecutables(repoRoot)).toEqual([
      path.join(repoRoot, "src-tauri", "target", "debug", "codevo-editor"),
      path.join(
        repoRoot,
        "src-tauri",
        "target",
        "debug",
        "bundle",
        "macos",
        "Codevo Editor.app",
        "Contents",
        "MacOS",
        "codevo-editor",
      ),
      path.join(repoRoot, "src-tauri", "target", "debug", "mockor-editor"),
      path.join(
        repoRoot,
        "src-tauri",
        "target",
        "debug",
        "bundle",
        "macos",
        "Mockor Editor.app",
        "Contents",
        "MacOS",
        "mockor-editor",
      ),
    ]);
  });
});
