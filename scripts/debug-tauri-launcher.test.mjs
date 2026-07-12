import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { spawnDebugApp } from "./debug-tauri-launcher.mjs";

describe("spawnDebugApp", () => {
  it("spawns the current bundled Codevo executable", () => {
    const repoRoot = path.join(path.sep, "workspace", "editor");
    const child = { pid: 42 };
    const spawnProcess = vi.fn(() => child);

    expect(spawnDebugApp(repoRoot, spawnProcess)).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith(
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
      { stdio: "inherit" },
    );
  });
});
