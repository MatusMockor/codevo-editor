import type { JsTestRunner } from "../domain/jsTestCommand";
import { packageToolSearchContexts } from "../domain/packageToolContext";
import { joinWorkspacePath } from "../domain/workspace";

export type WorkspaceFileReader = (path: string) => Promise<string | null>;

export interface JsTestRunnerContext {
  executablePath: string | null;
  rootPath: string;
  runner: JsTestRunner;
  targetRelativePath: string;
}

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
  targetPath?: string | null,
): Promise<JsTestRunner | null> {
  return (await detectJsTestRunnerContext(rootPath, readFileIfExists, targetPath))?.runner ?? null;
}

export async function detectJsTestRunnerContext(
  rootPath: string,
  readFileIfExists: WorkspaceFileReader,
  targetPath?: string | null,
): Promise<JsTestRunnerContext | null> {
  const contexts = packageToolSearchContexts(rootPath, targetPath);
  for (const [index, context] of contexts.entries()) {
    const runner = await detectRunnerAtRoot(context.rootPath, readFileIfExists);
    if (runner) {
      return {
        ...context,
        executablePath: await nearestRunnerExecutable(
          contexts,
          index,
          runner,
          readFileIfExists,
        ),
        runner,
      };
    }
  }
  return null;
}

async function nearestRunnerExecutable(
  contexts: readonly { rootPath: string }[],
  configuredAt: number,
  runner: JsTestRunner,
  readFileIfExists: WorkspaceFileReader,
): Promise<string | null> {
  const configuredRoot = contexts[configuredAt]?.rootPath;
  if (!configuredRoot) {
    return null;
  }
  const packageIndex = await nearestPackageIndex(contexts, readFileIfExists);
  for (const context of contexts.slice(packageIndex)) {
    const binary = joinWorkspacePath(context.rootPath, `node_modules/.bin/${runner}`);
    if ((await readFileIfExists(binary)) === null) {
      continue;
    }
    return executableRelativeTo(configuredRoot, context.rootPath, runner);
  }
  return null;
}

async function nearestPackageIndex(
  contexts: readonly { rootPath: string }[],
  readFileIfExists: WorkspaceFileReader,
): Promise<number> {
  for (const [index, context] of contexts.entries()) {
    const manifest = joinWorkspacePath(context.rootPath, "package.json");
    if ((await readFileIfExists(manifest)) !== null) {
      return index;
    }
  }
  return Math.max(0, contexts.length - 1);
}

function executableRelativeTo(
  configuredRoot: string,
  binaryRoot: string,
  runner: JsTestRunner,
): string {
  if (configuredRoot === binaryRoot) {
    return `node_modules/.bin/${runner}`;
  }
  const configuredSegments = configuredRoot.split("/").filter(Boolean);
  const binarySegments = binaryRoot.split("/").filter(Boolean);
  let shared = 0;
  while (
    shared < configuredSegments.length &&
    shared < binarySegments.length &&
    configuredSegments[shared] === binarySegments[shared]
  ) {
    shared += 1;
  }
  const parentSegments = Array.from(
    { length: configuredSegments.length - shared },
    () => "..",
  );
  return [
    ...parentSegments,
    ...binarySegments.slice(shared),
    "node_modules",
    ".bin",
    runner,
  ].join("/");
}

async function detectRunnerAtRoot(
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
