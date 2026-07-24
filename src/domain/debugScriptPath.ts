export function isDebuggableNodeScriptPath(path: string): boolean {
  return !/\.d\.(?:ts|mts|cts)$/u.test(path) && /\.(?:js|mjs|cjs|ts|tsx|mts|cts)$/u.test(path);
}

export function isDebuggablePhpScriptPath(path: string): boolean {
  return /\.php$/u.test(path);
}
