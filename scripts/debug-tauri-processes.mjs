import path from "node:path";

function debugRootOf(repoRoot) {
  return path.join(repoRoot, "src-tauri", "target", "debug");
}

function macosBundleExecutable(repoRoot, productName, binaryName) {
  return path.join(
    debugRootOf(repoRoot),
    "bundle",
    "macos",
    `${productName}.app`,
    "Contents",
    "MacOS",
    binaryName,
  );
}

export function debugAppLaunchExecutable(
  repoRoot,
  platform = process.platform,
) {
  if (platform === "darwin") {
    return macosBundleExecutable(repoRoot, "Codevo Editor", "codevo-editor");
  }

  const binaryName =
    platform === "win32" ? "codevo-editor.exe" : "codevo-editor";

  return path.join(debugRootOf(repoRoot), binaryName);
}

export function debugAppExecutables(repoRoot) {
  const debugRoot = debugRootOf(repoRoot);

  return [
    path.join(debugRoot, "codevo-editor"),
    path.join(debugRoot, "codevo-editor.exe"),
    macosBundleExecutable(repoRoot, "Codevo Editor", "codevo-editor"),
    path.join(debugRoot, "mockor-editor"),
    macosBundleExecutable(repoRoot, "Mockor Editor", "mockor-editor"),
  ];
}
