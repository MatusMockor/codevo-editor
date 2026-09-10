import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { spawnDebugApp } from "./debug-tauri-launcher.mjs";
import { debugAppLaunchExecutable } from "./debug-tauri-processes.mjs";

describe("spawnDebugApp", () => {
  it("spawns the debug executable for the current platform", () => {
    const repoRoot = path.join(path.sep, "workspace", "editor");
    const child = { pid: 42 };
    const spawnProcess = vi.fn(() => child);

    expect(spawnDebugApp(repoRoot, spawnProcess)).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith(
      debugAppLaunchExecutable(repoRoot),
      { stdio: "inherit" },
    );
  });

  it("spawns the plain unbundled binary on macOS, matching `debug:build --no-bundle` output", () => {
    const repoRoot = path.join(path.sep, "workspace", "editor");
    const child = { pid: 42 };
    const spawnProcess = vi.fn(() => child);
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      spawnDebugApp(repoRoot, spawnProcess);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }

    expect(spawnProcess).toHaveBeenCalledWith(
      path.join(repoRoot, "src-tauri", "target", "debug", "codevo-editor"),
      { stdio: "inherit" },
    );
  });
});
