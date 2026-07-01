const javascriptTypeScriptWatchedExtensions = new Set([
  "cjs",
  "cts",
  "js",
  "json",
  "jsx",
  "mjs",
  "mts",
  "ts",
  "tsx",
]);

const javascriptTypeScriptProjectGraphFileNames = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export function isJavaScriptTypeScriptWatchedPath(path: string): boolean {
  const fileName = path.split(/[\\/]/).pop() ?? "";

  if (javascriptTypeScriptProjectGraphFileNames.has(fileName)) {
    return true;
  }

  const extension = fileName.split(".").pop()?.toLowerCase();

  return Boolean(extension && javascriptTypeScriptWatchedExtensions.has(extension));
}
