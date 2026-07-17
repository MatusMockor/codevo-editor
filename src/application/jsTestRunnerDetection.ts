import type { JsTestRunner } from "../domain/jsTestCommand";
import { joinWorkspacePath } from "../domain/workspace";

export type WorkspaceFileReader = (path: string) => Promise<string | null>;

const VITEST_CONFIG_FILES = [
  "vitest.config.ts",
  "vitest.config.js",
  "vitest.config.mts",
  "vitest.config.mjs",
  "vitest.config.cts",
  "vitest.config.cjs",
];

const VITE_CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
  "vite.config.cts",
  "vite.config.cjs",
];

const JEST_CONFIG_FILES = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.cjs",
  "jest.config.mjs",
  "jest.config.json",
];

export async function detectJsTestRunner(
  rootPath: string,
  readFileIfExists: WorkspaceFileReader,
): Promise<JsTestRunner | null> {
  const packageJson = parsePackageJson(
    await readFileIfExists(joinWorkspacePath(rootPath, "package.json")),
  );

  if (await hasAnyFile(rootPath, VITEST_CONFIG_FILES, readFileIfExists)) {
    return "vitest";
  }

  if (
    hasDependency(packageJson, "vitest") &&
    (await hasAnyFile(rootPath, VITE_CONFIG_FILES, readFileIfExists))
  ) {
    return "vitest";
  }

  if (await hasAnyFile(rootPath, JEST_CONFIG_FILES, readFileIfExists)) {
    return "jest";
  }

  if (packageJson && "jest" in packageJson) {
    return "jest";
  }

  if (hasDependency(packageJson, "jest")) {
    return "jest";
  }

  return null;
}

async function hasAnyFile(
  rootPath: string,
  names: readonly string[],
  readFileIfExists: WorkspaceFileReader,
): Promise<boolean> {
  const contents = await Promise.all(
    names.map((name) => readFileIfExists(joinWorkspacePath(rootPath, name))),
  );

  return contents.some((content) => content !== null);
}

function parsePackageJson(content: string | null): Record<string, unknown> | null {
  if (content === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(content);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasDependency(
  packageJson: Record<string, unknown> | null,
  name: string,
): boolean {
  if (!packageJson) {
    return false;
  }

  return ["dependencies", "devDependencies"].some((section) => {
    const dependencies = packageJson[section];

    if (!dependencies || typeof dependencies !== "object") {
      return false;
    }

    return name in dependencies;
  });
}
