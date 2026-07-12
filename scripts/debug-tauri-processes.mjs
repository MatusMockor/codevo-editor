import path from "node:path";

export function debugAppExecutables(repoRoot) {
  const debugRoot = path.join(repoRoot, "src-tauri", "target", "debug");

  return [
    path.join(debugRoot, "codevo-editor"),
    path.join(
      debugRoot,
      "bundle",
      "macos",
      "Codevo Editor.app",
      "Contents",
      "MacOS",
      "codevo-editor",
    ),
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
  ];
}
