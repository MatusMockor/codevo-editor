const testFileNamePattern = /\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;

const jsExtensionPattern = /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;

const declarationFilePattern = /\.d\.(?:ts|mts|cts)$/;

export function isJsTestRelativePath(path: string): boolean {
  const normalized = path.split("\\").join("/");

  if (!isJsSourceRelativePath(normalized)) return false;

  if (testFileNamePattern.test(normalized)) {
    return true;
  }

  return normalized.split("/").slice(0, -1).includes("__tests__");
}

export function isJsSourceRelativePath(path: string): boolean {
  const normalized = path.split("\\").join("/");
  return jsExtensionPattern.test(normalized) && !declarationFilePattern.test(normalized);
}
