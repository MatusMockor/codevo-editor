const testFileNamePattern = /\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;

const jsExtensionPattern = /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;

const declarationFilePattern = /\.d\.(?:ts|mts|cts)$/;

export function isJsTestRelativePath(path: string): boolean {
  const normalized = path.split("\\").join("/");

  if (declarationFilePattern.test(normalized)) {
    return false;
  }

  if (testFileNamePattern.test(normalized)) {
    return true;
  }

  if (!jsExtensionPattern.test(normalized)) {
    return false;
  }

  return normalized.split("/").slice(0, -1).includes("__tests__");
}
