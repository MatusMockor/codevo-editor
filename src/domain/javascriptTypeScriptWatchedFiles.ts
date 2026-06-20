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

export function isJavaScriptTypeScriptWatchedPath(path: string): boolean {
  const fileName = path.split(/[\\/]/).pop() ?? "";
  const extension = fileName.split(".").pop()?.toLowerCase();

  return Boolean(extension && javascriptTypeScriptWatchedExtensions.has(extension));
}
